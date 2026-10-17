pipeline {
    agent { label 'haen-linux-build' }
    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        disableRestartFromStage()
        timeout(time: 90, unit: 'MINUTES')
        buildDiscarder(logRotator(daysToKeepStr: '7', numToKeepStr: '20', artifactDaysToKeepStr: '30', artifactNumToKeepStr: '10'))
    }
    parameters {
        string(name: 'SOURCE_COMMIT', defaultValue: '', description: '必填：已审核的完整 40 位 Git 提交号')
        booleanParam(name: 'PUBLISH_IMAGES', defaultValue: false, description: '验收通过后，经人工确认分发镜像；不部署应用')
    }
    environment {
        CI = 'true'
        RECOGNITION_ENABLED = 'false'
    }
    stages {
        stage('固定源码') {
            steps {
                deleteDir()
                script {
                    if (!(params.SOURCE_COMMIT ==~ /[a-f0-9]{40}/)) {
                        error('SOURCE_COMMIT 必须是完整提交号')
                    }
                }
                checkout([$class: 'GitSCM', branches: [[name: params.SOURCE_COMMIT]], userRemoteConfigs: scm.userRemoteConfigs, extensions: [[$class: 'CloneOption', noTags: true, shallow: false]]])
                withEnv(["HAEN_SOURCE_COMMIT=${params.SOURCE_COMMIT}"]) {
                    sh '''#!/bin/sh
set -eu
set +x
test "$(git rev-parse HEAD)" = "$HAEN_SOURCE_COMMIT"
node -e 'if(process.version!=="v24.9.0")process.exit(1)'
test "$(pnpm --version)" = '12.5.1'
'''
                }
                script { env.HAEN_SOURCE_COMMIT = params.SOURCE_COMMIT }
            }
        }
        stage('工程检查') {
            steps {
                sh '''#!/bin/sh
set -eu
set +x
pnpm install --frozen-lockfile
pnpm check
pnpm docs:check
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
'''
            }
        }
        stage('构建同版本镜像') {
            steps { sh 'node scripts/release/pipeline.mjs build' }
        }
        stage('隔离容器验收') {
            steps { sh 'node scripts/release/pipeline.mjs test-images' }
        }
        stage('人工确认分发') {
            when { expression { params.PUBLISH_IMAGES } }
            steps {
                script {
                    if (currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause').isEmpty()) {
                        error('镜像分发要求人工发起构建')
                    }
                    if (!env.HAEN_RELEASE_APPROVERS?.trim()) {
                        error('请先配置获授权的镜像分发审批人或组')
                    }
                    input(message: "将已验收提交 ${params.SOURCE_COMMIT} 的镜像分发到配置仓库？", submitter: env.HAEN_RELEASE_APPROVERS)
                }
            }
        }
        stage('分发不可变产物') {
            when { expression { params.PUBLISH_IMAGES } }
            steps {
                withCredentials([file(credentialsId: 'haen-image-registry-config', variable: 'HAEN_REGISTRY_CONFIG_FILE')]) {
                    sh 'node scripts/release/pipeline.mjs publish'
                }
            }
        }
    }
    post {
        always {
            archiveArtifacts(artifacts: '.local/archive/release-pipeline/build.json,.local/archive/release-pipeline/image-check.json,.local/archive/release-pipeline/release.json', allowEmptyArchive: true, fingerprint: true)
        }
    }
}
