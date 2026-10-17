def approvedTarget = [:]

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
        booleanParam(name: 'PUBLISH_IMAGES', defaultValue: false, description: '验收通过后人工分发镜像；目标更新由独立参数和审批决定')
        booleanParam(name: 'DEPLOY_TARGET', defaultValue: false, description: '分发后，另经人工确认更新指定目标主机')
        choice(name: 'DEPLOY_SCOPE', choices: ['full', 'web', 'server'], description: '目标更新范围；分端更新需确认兼容性')
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
                    if (params.DEPLOY_TARGET && !params.PUBLISH_IMAGES) {
                        error('目标发布必须先分发同一任务已验收的镜像')
                    }
                    if (params.DEPLOY_TARGET && !['full', 'web', 'server'].contains(params.DEPLOY_SCOPE)) {
                        error('无效的目标更新范围')
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
        stage('生产客户端持续运行') {
            steps {
                withEnv(['HAEN_SOAK_SECONDS=600']) { sh 'pnpm test:performance' }
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
        stage('人工确认目标发布') {
            when { expression { params.DEPLOY_TARGET } }
            steps {
                script {
                    if (currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause').isEmpty()) {
                        error('目标发布要求人工发起构建')
                    }
                    if (!env.HAEN_DEPLOY_APPROVERS?.trim()) {
                        error('请先配置目标发布审批人或组')
                    }
                    env.HAEN_DEPLOY_SCOPE = params.DEPLOY_SCOPE
                    def handoffDigest = sh(returnStdout: true, script: '''#!/bin/sh
set -eu
set +x
node scripts/release/handoff.mjs seal
''').trim()
                    if (!(handoffDigest ==~ /[a-f0-9]{64}/)) {
                        error('无效的交接材料摘要')
                    }
                    stash(name: 'haen-target-handoff', includes: '.local/archive/release-pipeline/deploy-handoff.json', useDefaultExcludes: false)
                    def proposed = [name: env.HAEN_TARGET_NAME, site: env.HAEN_TARGET_SITE, databaseFingerprint: env.HAEN_TARGET_DATABASE_FINGERPRINT, platform: env.HAEN_RELEASE_PLATFORM, source: params.SOURCE_COMMIT, scope: params.DEPLOY_SCOPE, digest: handoffDigest]
                    def approved = input(message: "更新 ${proposed.name} (${proposed.site})，范围 ${proposed.scope}，提交 ${proposed.source}，交接摘要 ${proposed.digest}。目标数据库指纹 ${proposed.databaseFingerprint}。", submitter: env.HAEN_DEPLOY_APPROVERS, parameters: [
                        booleanParam(name: 'OTHER_WRITERS_STOPPED', defaultValue: false, description: '需要迁移或首次同步时：已核对其他写入方、连接和长事务已停止'),
                        booleanParam(name: 'CONTRACT_COMPATIBLE', defaultValue: false, description: '分端更新时：保留的一端与新接口、结构及数据兼容'),
                        booleanParam(name: 'INITIALIZE_EMPTY', defaultValue: false, description: '首次部署时：允许初始化已预建且经预检证明为空的库'),
                        booleanParam(name: 'BOOTSTRAP_CATALOG', defaultValue: false, description: '没有就绪目录时：允许同步真实电台目录')
                    ])
                    approvedTarget = proposed + [otherWriters: (approved.OTHER_WRITERS_STOPPED == true).toString(), compatible: (approved.CONTRACT_COMPATIBLE == true).toString(), initialize: (approved.INITIALIZE_EMPTY == true).toString(), catalog: (approved.BOOTSTRAP_CATALOG == true).toString()]
                }
            }
        }
        stage('目标主机更新') {
            when {
                beforeAgent true
                expression { params.DEPLOY_TARGET }
            }
            agent { label 'haen-linux-target' }
            steps {
                script {
                    if (!(approvedTarget.digest ==~ /[a-f0-9]{64}/)) {
                        error('没有完整的目标发布审批上下文')
                    }
                    def previousWorkspace = pwd()
                    withEnv([
                        'CI=true',
                        "HAEN_JENKINS_WORKSPACE_ROOT=${previousWorkspace}",
                        "HAEN_SOURCE_COMMIT=${approvedTarget.source}",
                        "HAEN_RELEASE_PLATFORM=${approvedTarget.platform}",
                        "HAEN_TARGET_NAME=${approvedTarget.name}",
                        "HAEN_TARGET_SITE=${approvedTarget.site}",
                        "HAEN_TARGET_DATABASE_FINGERPRINT=${approvedTarget.databaseFingerprint}",
                        "HAEN_DEPLOY_SCOPE=${approvedTarget.scope}",
                        "HAEN_APPROVED_HANDOFF_SHA256=${approvedTarget.digest}",
                        "HAEN_OTHER_WRITERS_STOPPED=${approvedTarget.otherWriters}",
                        "HAEN_CONTRACT_COMPATIBILITY_CONFIRMED=${approvedTarget.compatible}",
                        "MIGRATION_INITIALIZE_EMPTY=${approvedTarget.initialize}",
                        "HAEN_BOOTSTRAP_CATALOG=${approvedTarget.catalog}",
                        'NODE_OPTIONS=',
                        'NODE_DEBUG=',
                        'NODE_DEBUG_NATIVE=',
                        'NODE_TLS_REJECT_UNAUTHORIZED=1'
                    ]) {
                        ws("${previousWorkspace}-release-${env.BUILD_NUMBER}") {
                            sh '''#!/bin/sh
set -eu
set +x
node -e 'if(process.version!=="v24.9.0")process.exit(1)'
node --input-type=module -e 'import {readdirSync} from "node:fs"; if(readdirSync(".").length)process.exit(1)'
'''
                            checkout([$class: 'GitSCM', branches: [[name: approvedTarget.source]], userRemoteConfigs: scm.userRemoteConfigs, extensions: [[$class: 'CloneOption', noTags: true, shallow: false]]])
                            sh '''#!/bin/sh
set -eu
set +x
node -e 'if(process.version!=="v24.9.0")process.exit(1)'
test "$(pnpm --version)" = '12.5.1'
node scripts/release/handoff.mjs prepare-target
pnpm install --frozen-lockfile
pnpm --filter @haen/contracts build
pnpm --filter @haen/server build
'''
                            unstash 'haen-target-handoff'
                            def releaseDigest = sh(returnStdout: true, script: '''#!/bin/sh
set -eu
set +x
node scripts/release/handoff.mjs accept
''').trim()
                            if (!(releaseDigest ==~ /[a-f0-9]{64}/)) {
                                error('目标交接材料未通过核验')
                            }
                            withEnv([
                                'HAEN_CI_DEPLOY=true',
                                'HAEN_DEPLOY_ACTION=apply',
                                "HAEN_EXPECTED_RELEASE_SHA256=${releaseDigest}",
                                "HAEN_EXPECTED_DATABASE_FINGERPRINT=${approvedTarget.databaseFingerprint}",
                                "HAEN_EXPECTED_SITE=${approvedTarget.site}",
                                "HAEN_RELEASE_FILE=${pwd()}/.local/archive/release-pipeline/target-release.json"
                            ]) {
                                withCredentials([file(credentialsId: 'haen-image-registry-pull-config', variable: 'HAEN_REGISTRY_CONFIG_FILE')]) {
                                    sh '''#!/bin/sh
set -eu
set +x
node --env-file="$HAEN_DEPLOY_ENV_FILE" apps/server/dist/entrypoints/deploy.js
'''
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    post {
        always {
            archiveArtifacts(artifacts: '.local/archive/release-pipeline/build.json,.local/archive/release-pipeline/image-check.json,.local/archive/release-pipeline/release.json,.local/archive/release-pipeline/deploy-handoff.json', allowEmptyArchive: true, fingerprint: true)
        }
    }
}
