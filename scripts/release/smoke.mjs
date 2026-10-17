import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { imageReference, roles } from './common.mjs';
import { assertImages } from './images.mjs';
import { runtimeLogProbe } from '../deploy/runtime-logs.mjs';

const label = 'org.haen.ci.run';
export async function smokeImages(run, build, mysqlImage, directory, signal) {
  imageReference(mysqlImage);
  await assertImages(run, build);
  const token = randomBytes(6).toString('hex');
  const prefix = 'haen-ci-' + build.run + '-' + token;
  const names = ['mysql', 'migration', 'seed', 'api', 'jobs', 'web'].map(
    (role) => prefix + '-' + role,
  );
  const [mysqlName, migrationName, seedName, apiName, jobsName, webName] = names;
  const network = prefix + '-network';
  const work = await mkdtemp(join(directory, '.smoke-'));
  const password = randomBytes(32).toString('hex');
  const database = 'ha_radio_test_ci_' + token;
  const client = join(work, 'client.cnf'),
    mysqlEnv = join(work, 'mysql.env'),
    appEnv = join(work, 'app.env');
  let result;
  console.info(JSON.stringify({ event: 'image_test_started', run: build.run, resourceRun: token }));
  const normalSignal = new AbortController().signal;
  const inspect = async (name) =>
    JSON.parse(await run(['inspect', '--format', '{{json .State}}', name]));
  const retry = async (operation, attempts = 90) => {
    for (let n = 0; n < attempts; n++) {
      signal?.throwIfAborted();
      try {
        return await operation();
      } catch {
        if (n === attempts - 1) throw Error('Image readiness failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };
  const appArgs = (role, name) => [
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    label + '=' + token,
    '--network',
    'container:' + mysqlName,
    '--env-file',
    appEnv,
    '--read-only',
    '--tmpfs',
    '/tmp:size=32m',
    '--env',
    'HAEN_LOG_DIRECTORY=/var/log/haen',
    '--tmpfs',
    '/var/log/haen:size=32m,mode=700,uid=1000,gid=1000',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    build.images[role].id,
  ];
  const checkLogs = (name, service, event) =>
    run([
      'exec',
      name,
      'node',
      '--input-type=module',
      '-e',
      runtimeLogProbe(service, build.revision, event),
    ]);
  const sql = (query) =>
    run([
      'exec',
      '--user',
      '0',
      mysqlName,
      'mysql',
      '--defaults-file=/run/haen-client.cnf',
      '--batch',
      '--skip-column-names',
      database,
      '-e',
      query,
    ]);
  try {
    await writeFile(mysqlEnv, `MYSQL_ROOT_PASSWORD=${password}\nMYSQL_DATABASE=${database}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(
      client,
      `[client]\nuser=root\npassword=${password}\nprotocol=SOCKET\nssl-mode=DISABLED\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(
      appEnv,
      `NODE_ENV=test\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=${database}\nDB_USER=root\nDB_PASSWORD=${password}\nDB_TLS=disabled\nHOST=0.0.0.0\nPORT=3001\nAPI_DOCS_ENABLED=false\nRECOGNITION_ENABLED=false\nMIGRATION_WRITES_STOPPED=true\nMIGRATION_INITIALIZE_EMPTY=true\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await run(['pull', mysqlImage], { capture: false, timeout: 900000 });
    await run(['network', 'create', '--internal', '--label', label + '=' + token, network]);
    await run([
      'run',
      '--detach',
      '--name',
      mysqlName,
      '--label',
      label + '=' + token,
      '--network',
      network,
      '--network-alias',
      'api',
      '--env-file',
      mysqlEnv,
      '--mount',
      `type=bind,src=${client},dst=/run/haen-client.cnf,readonly`,
      '--tmpfs',
      '/var/lib/mysql:size=1g',
      mysqlImage,
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_general_ci',
      '--default-time-zone=+00:00',
    ]);
    await retry(async () => assert.equal((await sql('SELECT VERSION()')).split('-')[0], '8.0.46'));
    const migration = async () => {
      await run(
        [
          'run',
          '--name',
          migrationName,
          '--label',
          label + '=' + token,
          '--network',
          'container:' + mysqlName,
          '--env-file',
          appEnv,
          '--read-only',
          '--tmpfs',
          '/tmp:size=32m',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          build.images.migration.id,
        ],
        { timeout: 180000 },
      );
      await run(['rm', migrationName]);
    };
    await migration();
    await migration();
    assert.deepEqual(
      (await sql('SELECT hash FROM __drizzle_migrations ORDER BY id')).split('\n'),
      build.migrations.map((item) => item.sha256),
    );
    const tables = Number(
      await sql('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'),
    );
    assert(Number.isInteger(tables) && tables > 1);
    assert.equal(
      await sql(
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND (ENGINE<>'InnoDB' OR TABLE_COLLATION<>'utf8mb4_general_ci' OR ROW_FORMAT<>'Dynamic')",
      ),
      '0',
    );
    const seed = fileURLToPath(new URL('./seed.mjs', import.meta.url));
    await run([
      'run',
      '--name',
      seedName,
      '--label',
      label + '=' + token,
      '--network',
      'container:' + mysqlName,
      '--env-file',
      appEnv,
      '--read-only',
      '--tmpfs',
      '/tmp:size=32m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--mount',
      `type=bind,src=${seed},dst=/run/haen-seed.mjs,readonly`,
      '--entrypoint',
      'node',
      build.images.migration.id,
      '/run/haen-seed.mjs',
    ]);
    await run(appArgs('server', apiName));
    await retry(async () =>
      assert.equal(
        await run([
          'exec',
          apiName,
          'node',
          '-e',
          "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(async r=>{if(!r.ok)process.exit(1);console.log((await r.json()).status)}).catch(()=>process.exit(1))",
        ]),
        'ready',
      ),
    );
    assert.equal(await checkLogs(apiName, 'api', 'request_completed'), 'ready');
    await run([...appArgs('server', jobsName), 'dist/entrypoints/jobs.js']);
    await retry(
      async () => assert.equal(await checkLogs(jobsName, 'jobs', 'scheduler_started'), 'ready'),
      10,
    );
    assert.equal((await inspect(jobsName)).Running, true);
    await run([
      'run',
      '--detach',
      '--name',
      webName,
      '--label',
      label + '=' + token,
      '--network',
      network,
      '--env',
      'HAEN_SITE=http://:8080',
      '--read-only',
      '--tmpfs',
      '/tmp:size=16m',
      '--tmpfs',
      '/data:size=16m,uid=1000,gid=1000',
      '--tmpfs',
      '/config:size=16m,uid=1000,gid=1000',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      build.images.web.id,
    ]);
    const web = (path) =>
      run(['exec', webName, 'wget', '-q', '-O', '-', 'http://127.0.0.1:8080' + path]);
    const html = await retry(() => web('/'));
    assert(html.includes('<div id="root"></div>'));
    const asset = html.match(/(?:src|href)="(\/assets\/[a-zA-Z0-9._-]+\.(?:js|css))"/)?.[1];
    assert(asset && (await web(asset)).length > 0);
    assert.equal(JSON.parse(await web('/api/v1/health/ready')).status, 'ready');
    assert.equal(
      JSON.parse(await web('/api/v1/stations/00000000-0000-4000-8000-000000000001')).name,
      '镜像验收 🌊',
    );
    const beforeStop = await inspect(apiName);
    assert.equal(beforeStop.Running, true);
    await run(['stop', '--time', '20', jobsName, apiName, webName], { timeout: 90000 });
    assert.equal((await inspect(apiName)).ExitCode, 0);
    assert.equal((await inspect(jobsName)).ExitCode, 0);
    result = {
      format: 1,
      revision: build.revision,
      run: build.run,
      images: Object.fromEntries(roles.map((role) => [role, build.images[role].id])),
      tables,
      migrations: build.migrations.length,
      mysql: '8.0.46',
      checks: {
        migration: true,
        repeatedMigration: true,
        api: true,
        jobs: true,
        web: true,
        staticAsset: true,
        cleanup: false,
      },
    };
  } finally {
    let cleaned = true;
    for (const name of names.toReversed()) {
      try {
        const present = await run(['ps', '--all', '--quiet', '--filter', 'name=^/' + name + '$'], {
          signal: normalSignal,
        });
        if (!present) continue;
        const metadata = JSON.parse(
          await run(['inspect', '--format', '{{json .Config.Labels}}', name], {
            signal: normalSignal,
          }),
        );
        assert.equal(metadata?.[label], token);
        await run(['rm', '--force', '--volumes', name], { signal: normalSignal, timeout: 30000 });
        assert.equal(
          await run(['ps', '--all', '--quiet', '--filter', 'name=^/' + name + '$'], {
            signal: normalSignal,
          }),
          '',
        );
      } catch {
        cleaned = false;
      }
    }
    try {
      const present = await run(
        ['network', 'ls', '--quiet', '--filter', 'name=^' + network + '$'],
        { signal: normalSignal },
      );
      if (present) {
        const [metadata] = JSON.parse(
          await run(['network', 'inspect', network], { signal: normalSignal }),
        );
        assert.equal(metadata.Labels?.[label], token);
        await run(['network', 'rm', network], { signal: normalSignal });
        assert.equal(
          await run(['network', 'ls', '--quiet', '--filter', 'name=^' + network + '$'], {
            signal: normalSignal,
          }),
          '',
        );
      }
    } catch {
      cleaned = false;
    }
    await rm(work, { recursive: true, force: true });
    assert(cleaned, 'Owned image test resources need inspection');
  }
  result.checks.cleanup = true;
  return result;
}
