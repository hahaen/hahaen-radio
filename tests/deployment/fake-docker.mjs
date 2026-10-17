#!/usr/bin/env node
// Deliberately simulated CLI for orchestration tests. It never opens a Docker socket.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2),
  root = process.env.FAKE_DOCKER_STATE;
const state = JSON.parse(readFileSync(root, 'utf8'));
const digest = (text) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const value = (flag) => args[args.indexOf(flag) + 1];
const respond = (value) => {
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
};
appendFileSync(root + '.calls', JSON.stringify(args) + '\n');
let failed = false;
try {
  if (args[0] === 'context')
    respond([{ Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }]);
  else if (args[0] === 'info')
    respond({
      OSType: 'linux',
      Architecture: 'amd64',
      RegistryConfig: { InsecureRegistryCIDRs: ['127.0.0.0/8'], IndexConfigs: {} },
    });
  else if (args[0] === 'build') {
    const tag = value('--tag'),
      role = value('--target'),
      revision = value('--build-arg').slice('VCS_REF='.length);
    state.images[tag] = {
      Id: digest(role),
      Os: 'linux',
      Architecture: 'amd64',
      Config: { Labels: { 'org.opencontainers.image.revision': revision } },
      RepoDigests: [],
    };
  } else if (args[0] === 'image' && args[1] === 'inspect') {
    const image = state.images[args[2]];
    if (!image) throw Error();
    respond([process.env.FAKE_CHANGED_TAG ? { ...image, Id: digest('changed') } : image]);
  } else if (args[0] === 'push') {
    const tag = args[1],
      repository = tag.slice(0, tag.lastIndexOf(':'));
    state.images[tag].RepoDigests = [repository + '@' + digest('remote-' + repository)];
  } else if (args[0] === 'buildx') {
    const reference = args.at(-1),
      repository = reference.split('@')[0],
      role = repository.split('/').at(-1);
    if (process.env.FAKE_INDEX && !reference.endsWith(digest('child-' + role)))
      respond({
        manifests: [
          { digest: digest('child-' + role), platform: { os: 'linux', architecture: 'amd64' } },
        ],
      });
    else
      respond({ config: { digest: digest(process.env.FAKE_REMOTE_MISMATCH ? 'changed' : role) } });
  } else if (args[0] === 'pull') {
    // No network access in this fake.
  } else if (args[0] === 'network') {
    const name = args.at(-1);
    if (args[1] === 'create')
      state.networks[name] = { Labels: { 'org.haen.ci.run': value('--label').split('=')[1] } };
    else if (args[1] === 'inspect') respond([state.networks[name]]);
    else if (args[1] === 'rm') delete state.networks[name];
    else if (args[1] === 'ls') {
      const name = value('--filter').slice('name=^'.length, -1);
      respond(state.networks[name] ? 'network-id' : '');
    } else throw Error();
  } else if (args[0] === 'run') {
    const name = value('--name');
    if (state.containers[name]) throw Error();
    state.containers[name] = {
      Labels: { 'org.haen.ci.run': value('--label').split('=')[1] },
      State: { Running: args.includes('--detach'), ExitCode: 0 },
    };
  } else if (args[0] === 'inspect') {
    const container = state.containers[args.at(-1)];
    if (!container) throw Error();
    respond(value('--format').includes('Labels') ? container.Labels : container.State);
  } else if (args[0] === 'ps') {
    const name = value('--filter').slice('name=^/'.length, -1);
    respond(state.containers[name] ? 'container-id' : '');
  } else if (args[0] === 'rm') {
    if (process.env.FAKE_CLEANUP_FAILURE && args.includes('--force')) throw Error();
    for (const name of args.slice(1).filter((value) => !value.startsWith('--')))
      delete state.containers[name];
  } else if (args[0] === 'logs') respond('{"event":"scheduler_started"}');
  else if (args[0] === 'stop') {
    for (const name of args.slice(3)) state.containers[name].State.Running = false;
  } else if (args[0] === 'exec') {
    const sql = args.at(-1);
    if (args.includes('mysql')) {
      if (sql === 'SELECT VERSION()') respond('8.0.46');
      else if (sql.startsWith('SELECT hash'))
        respond(
          JSON.parse(readFileSync('.local/archive/release-pipeline/build.json', 'utf8'))
            .migrations.map((item) => item.sha256)
            .join('\n'),
        );
      else if (sql.includes('ENGINE<>')) respond('0');
      else respond('11');
    } else if (args.includes('wget')) {
      const url = args.at(-1);
      if (url.endsWith('/health/ready')) respond({ status: 'ready' });
      else if (url.includes('/stations/')) respond({ name: '镜像验收 🌊' });
      else if (url.includes('/assets/')) respond('fixture-asset');
      else respond('<div id="root"></div><script src="/assets/fixture.js"></script>');
    } else respond('ready');
  } else throw Error();
} catch {
  failed = true;
  process.stderr.write('Synthetic private diagnostic must not be forwarded');
}
writeFileSync(root, JSON.stringify(state));
if (failed) process.exitCode = 1;
