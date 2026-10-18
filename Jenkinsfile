def selected = [:]
def databasePlan = [:]
def handoffDigest = ''

pipeline {
    agent none
    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        disableRestartFromStage()
        timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(daysToKeepStr: '7', numToKeepStr: '20', artifactDaysToKeepStr: '30', artifactNumToKeepStr: '10'))
    }
    parameters {
        gitParameter(name: 'BRANCH', type: 'PT_BRANCH', branchFilter: 'origin/(.*)', defaultValue: 'main', selectedValue: 'DEFAULT', sortMode: 'ASCENDING_SMART', quickFilterEnabled: false, useRepository: '.*', description: '选择此部分要发布的分支')
    }
    environment {
        CI = 'true'
        RECOGNITION_ENABLED = 'false'
    }
    stages {
        stage('固定源码与基础检查') {
            agent { label 'haen-linux-build' }
            steps {
                deleteDir()
                script {
                    def component = ['radio-frontend': 'frontend', 'radio-api': 'api', 'radio-jobs': 'jobs'][env.JOB_BASE_NAME]
                    if (!component) { error('只支持三个独立发布任务') }
                    env.HAEN_DEPLOY_SCOPE = component
                    def initiators = currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause')
                    for (def configured : [env.HAEN_RELEASE_APPROVERS, env.HAEN_DEPLOY_APPROVERS]) {
                        def allowed = (configured ?: '').split(',').collect { it.trim() }.findAll { it }
                        if (!initiators.any { allowed.contains(it.userId) }) { error('只有配置的发布用户可发起任务') }
                    }
                    def branch = params.BRANCH?.trim()
                    if (!branch || !(branch ==~ /[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}/)) { error('请选择有效的远端分支') }
                    withEnv(["HAEN_SOURCE_BRANCH=${branch}"]) {
                        sh 'git check-ref-format "refs/heads/$HAEN_SOURCE_BRANCH"'
                        checkout([$class: 'GitSCM', branches: [[name: "refs/remotes/origin/${branch}"]], userRemoteConfigs: scm.userRemoteConfigs, extensions: [[$class: 'CloneOption', noTags: true, shallow: false]]])
                        env.HAEN_SOURCE_COMMIT = sh(returnStdout: true, script: 'node deploy/scripts/release/source-selection.mjs').trim()
                    }
                    if (!(env.HAEN_SOURCE_COMMIT ==~ /[a-f0-9]{40}/)) { error('无法固定完整提交') }
                    env.HAEN_SOURCE_BRANCH = branch
                    selected = [source: env.HAEN_SOURCE_COMMIT, component: component, platform: env.HAEN_RELEASE_PLATFORM, target: env.HAEN_TARGET_NAME, site: env.HAEN_TARGET_SITE, fingerprint: env.HAEN_TARGET_DATABASE_FINGERPRINT]
                }
                sh '''#!/bin/sh
set -eu
set +x
node -e 'if(process.version!=="v24.9.0")process.exit(1)'
test "$(pnpm --version)" = '12.5.1'
pnpm install --frozen-lockfile
node deploy/scripts/component-release.mjs describe
case "$HAEN_DEPLOY_SCOPE" in frontend) app=web ;; api|jobs) app=server ;; *) exit 64 ;; esac
pnpm exec prettier --check 'deploy/**/*.{mjs,json,yaml}' 'packages/contracts/src/**/*.ts' "apps/$app/src/**/*.{ts,tsx,css}"
pnpm exec eslint deploy/scripts deploy/tests packages/contracts/src "apps/$app/src" --max-warnings 0
pnpm --filter @haen/contracts build
pnpm --filter "@haen/$app" typecheck
pnpm exec vitest run "apps/$app/src" packages/contracts/src deploy/tests/component-state.test.mjs deploy/tests/component-release.test.mjs deploy/tests/runtime-environment.test.mjs deploy/tests/local-images.test.mjs deploy/tests/static-web.test.mjs --maxWorkers=1
'''
            }
            post {
                always { archiveArtifacts(artifacts: '.local/archive/release-pipeline/source.json,.local/archive/release-pipeline/component-source.json', allowEmptyArchive: true, fingerprint: true) }
            }
        }
        stage('只读目标预检') {
            agent { label 'haen-linux-target' }
            steps {
                script {
                    ws("${pwd()}-plan-${env.BUILD_NUMBER}") {
                        deleteDir()
                        checkout([$class: 'GitSCM', branches: [[name: selected.source]], userRemoteConfigs: scm.userRemoteConfigs, extensions: [[$class: 'CloneOption', noTags: true, shallow: false]]])
                        withEnv(["HAEN_SOURCE_COMMIT=${selected.source}", "HAEN_DEPLOY_SCOPE=${selected.component}", "HAEN_RELEASE_PLATFORM=${selected.platform}", "HAEN_EXPECTED_SITE=${selected.site}", "HAEN_EXPECTED_DATABASE_FINGERPRINT=${selected.fingerprint}"]) {
                            sh 'pnpm install --frozen-lockfile'
                            def text = sh(returnStdout: true, script: '''#!/bin/sh
set -eu
set +x
node --env-file="$HAEN_DEPLOY_ENV_FILE" --import tsx deploy/scripts/component-plan.mjs
''').trim()
                            if (!(text ==~ /(true|false) [0-9]+/)) { error('目标只读预检失败') }
                            def fields = text.tokenize(' ')
                            databasePlan = [empty: fields[0] == 'true', pending: fields[1].toInteger()]
                        }
                    }
                }
            }
        }
        stage('构建和验收所需产物') {
            agent { label 'haen-linux-build' }
            steps {
                script {
                    checkout([$class: 'GitSCM', branches: [[name: selected.source]], userRemoteConfigs: scm.userRemoteConfigs, extensions: [[$class: 'CloneOption', noTags: true, shallow: false]]])
                    withEnv(["HAEN_SOURCE_COMMIT=${selected.source}", "HAEN_DEPLOY_SCOPE=${selected.component}", "HAEN_BUILD_MIGRATION=${databasePlan.pending > 0}"]) {
                        sh '''#!/bin/sh
set -eu
set +x
pnpm install --frozen-lockfile
node deploy/scripts/component-release.mjs build
node deploy/scripts/component-release.mjs test
'''
                    }
                }
                sh 'node deploy/scripts/component-release.mjs publish'
                script {
                    handoffDigest = sh(returnStdout: true, script: 'node deploy/scripts/component-release.mjs seal').trim()
                    if (!(handoffDigest ==~ /[a-f0-9]{64}/)) { error('无效的发布交接摘要') }
                    stash(name: 'radio-component-release', includes: '.local/archive/release-pipeline/component-handoff.json', useDefaultExcludes: false)
                }
            }
            post {
                always { archiveArtifacts(artifacts: '.local/archive/release-pipeline/component-build.json,.local/archive/release-pipeline/component-check.json,.local/archive/release-pipeline/component-release.json,.local/archive/release-pipeline/component-handoff.json', allowEmptyArchive: true, fingerprint: true) }
            }
        }
        stage('更新所选部分') {
            agent { label 'haen-linux-target' }
            steps {
                script {
                    def previousWorkspace = pwd()
                    withEnv(["HAEN_SOURCE_COMMIT=${selected.source}", "HAEN_DEPLOY_SCOPE=${selected.component}", "HAEN_RELEASE_PLATFORM=${selected.platform}", "HAEN_TARGET_NAME=${selected.target}", "HAEN_TARGET_SITE=${selected.site}", "HAEN_TARGET_DATABASE_FINGERPRINT=${selected.fingerprint}", "HAEN_EXPECTED_SITE=${selected.site}", "HAEN_EXPECTED_DATABASE_FINGERPRINT=${selected.fingerprint}", "HAEN_APPROVED_HANDOFF_SHA256=${handoffDigest}", "HAEN_JENKINS_WORKSPACE_ROOT=${previousWorkspace}", 'NODE_OPTIONS=', 'NODE_DEBUG=', 'NODE_DEBUG_NATIVE=', 'NODE_TLS_REJECT_UNAUTHORIZED=1']) {
                        ws("${previousWorkspace}-release-${env.BUILD_NUMBER}") {
                            deleteDir()
                            checkout([$class: 'GitSCM', branches: [[name: selected.source]], userRemoteConfigs: scm.userRemoteConfigs, extensions: [[$class: 'CloneOption', noTags: true, shallow: false]]])
                            sh 'pnpm install --frozen-lockfile'
                            unstash 'radio-component-release'
                            def releaseDigest = sh(returnStdout: true, script: 'node deploy/scripts/component-release.mjs accept').trim()
                            if (!(releaseDigest ==~ /[a-f0-9]{64}/)) { error('交接材料核验失败') }
                            if (databasePlan.pending > 0) {
                                input(message: "${selected.component} / ${selected.site} / ${selected.source}：${databasePlan.empty ? '首次空库初始化及真实目录同步' : '执行迁移，先完成备份和独立副本校验'}。确认其他写入方与长事务已停止；需要停写的未发布部分恢复原版本。", submitter: env.HAEN_DEPLOY_APPROVERS, ok: '确认数据库变更并发布')
                            }
                            withEnv(['HAEN_CI_DEPLOY=true', 'HAEN_DEPLOY_ACTION=apply', "HAEN_EXPECTED_RELEASE_SHA256=${releaseDigest}", "HAEN_RELEASE_FILE=${pwd()}/.local/archive/release-pipeline/target-release.json", "HAEN_OTHER_WRITERS_STOPPED=${databasePlan.pending > 0}", "MIGRATION_INITIALIZE_EMPTY=${databasePlan.empty}", "HAEN_BOOTSTRAP_CATALOG=${databasePlan.empty}"]) {
                                sh '''#!/bin/sh
set -eu
set +x
node --env-file="$HAEN_DEPLOY_ENV_FILE" --import tsx apps/server/src/entrypoints/deploy.ts
'''
                            }
                        }
                    }
                }
            }
        }
    }
}
