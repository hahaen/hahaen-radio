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
        gitParameter(name: 'BRANCH', type: 'PT_BRANCH', branchFilter: 'origin/(.*)', defaultValue: 'main', selectedValue: 'DEFAULT', sortMode: 'ASCENDING_SMART', quickFilterEnabled: false, useRepository: '.*', description: '选择要发布的分支；检查通过后完整部署前后端')
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
                    def initiators = currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')
                    for (def configured : [env.HAEN_RELEASE_APPROVERS, env.HAEN_DEPLOY_APPROVERS]) {
                        def allowed = (configured ?: '').split(',').collect { it.trim() }.findAll { it }
                        if (!initiators.any { allowed.contains(it.userId) }) {
                            error('只有配置的发布用户可发起此完整发布任务')
                        }
                    }
                    def branch = params.BRANCH?.trim()
                    if (!branch || !(branch ==~ /[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}/)) {
                        error('请选择有效的远端分支')
                    }
                    withEnv(["HAEN_SOURCE_BRANCH=${branch}"]) {
                        sh 'git check-ref-format "refs/heads/$HAEN_SOURCE_BRANCH"'
                        checkout([$class: 'GitSCM', branches: [[name: "refs/remotes/origin/${branch}"]], userRemoteConfigs: scm.userRemoteConfigs, extensions: [[$class: 'CloneOption', noTags: true, shallow: false]]])
                        env.HAEN_SOURCE_COMMIT = sh(returnStdout: true, script: 'node deploy/scripts/release/source-selection.mjs').trim()
                    }
                    if (!(env.HAEN_SOURCE_COMMIT ==~ /[a-f0-9]{40}/)) {
                        error('无法固定所选分支的完整提交')
                    }
                    env.HAEN_SOURCE_BRANCH = branch
                }
                sh '''#!/bin/sh
set -eu
set +x
node -e 'if(process.version!=="v24.9.0")process.exit(1)'
test "$(pnpm --version)" = '12.5.1'
'''
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
            steps {
                withEnv(["HAEN_WEB_BASE_PATH=${env.HAEN_RELEASE_WEB_BASE_PATH ?: '/'}"]) {
                    sh 'node deploy/scripts/release/pipeline.mjs build'
                }
            }
        }
        stage('隔离容器验收') {
            steps { sh 'node deploy/scripts/release/pipeline.mjs test-images' }
        }
        stage('分发不可变产物') {
            steps {
                withCredentials([file(credentialsId: 'haen-image-registry-config', variable: 'HAEN_REGISTRY_CONFIG_FILE')]) {
                    sh 'node deploy/scripts/release/pipeline.mjs publish'
                }
            }
        }
        stage('冻结目标与交接') {
            steps {
                script {
                    env.HAEN_DEPLOY_SCOPE = 'full'
                    def handoffDigest = sh(returnStdout: true, script: '''#!/bin/sh
set -eu
set +x
node deploy/scripts/release/handoff.mjs seal
''').trim()
                    if (!(handoffDigest ==~ /[a-f0-9]{64}/)) {
                        error('无效的交接材料摘要')
                    }
                    stash(name: 'haen-target-handoff', includes: '.local/archive/release-pipeline/deploy-handoff.json', useDefaultExcludes: false)
                    approvedTarget = [name: env.HAEN_TARGET_NAME, site: env.HAEN_TARGET_SITE, databaseFingerprint: env.HAEN_TARGET_DATABASE_FINGERPRINT, platform: env.HAEN_RELEASE_PLATFORM, source: env.HAEN_SOURCE_COMMIT, scope: 'full', digest: handoffDigest]
                }
            }
        }
        stage('目标主机更新') {
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
node deploy/scripts/release/handoff.mjs prepare-target
pnpm install --frozen-lockfile
pnpm --filter @haen/contracts build
pnpm --filter @haen/server build
'''
                            unstash 'haen-target-handoff'
                            def releaseDigest = sh(returnStdout: true, script: '''#!/bin/sh
set -eu
set +x
node deploy/scripts/release/handoff.mjs accept
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
                                def planText = sh(returnStdout: true, script: '''#!/bin/sh
set -eu
set +x
node --env-file="$HAEN_DEPLOY_ENV_FILE" deploy/scripts/release/target-plan.mjs
''').trim()
                                if (!(planText ==~ /(true|false) [0-9]+/)) {
                                    error('无效的数据库只读预检结果')
                                }
                                def fields = planText.tokenize(' ')
                                def plan = [empty: fields[0] == 'true', pending: fields[1].toInteger()]
                                def needsMigration = plan.pending > 0
                                if (needsMigration) {
                                    input(message: "${approvedTarget.site} / ${env.HAEN_SOURCE_BRANCH} / ${approvedTarget.source}：${plan.empty ? '首次空库初始化并同步真实目录' : '执行 ' + plan.pending + ' 项迁移，先完成备份和独立副本校验'}。确认其他写入方及长事务已停止后发布。", submitter: env.HAEN_DEPLOY_APPROVERS, ok: '确认数据库变更并发布')
                                }
                                withEnv([
                                    "HAEN_OTHER_WRITERS_STOPPED=${needsMigration}",
                                    'HAEN_CONTRACT_COMPATIBILITY_CONFIRMED=false',
                                    "MIGRATION_INITIALIZE_EMPTY=${plan.empty}",
                                    "HAEN_BOOTSTRAP_CATALOG=${plan.empty}"
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
    }
    post {
        always {
            archiveArtifacts(artifacts: '.local/archive/release-pipeline/source.json,.local/archive/release-pipeline/build.json,.local/archive/release-pipeline/image-check.json,.local/archive/release-pipeline/release.json,.local/archive/release-pipeline/deploy-handoff.json', allowEmptyArchive: true, fingerprint: true)
        }
    }
}
