#!/usr/bin/env python3
"""Build public runtime artifacts locally; upload over verified SSH and deploy."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RADIO = (ROOT / "apps/server").is_dir()
PROJECT = "radio" if RADIO else "ledger"
COMPONENTS = ("api", "jobs", "frontend") if RADIO else ("backend", "h5")


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def portable(directory):
    """Fail closed when dependencies need an OS-specific build or escape the bundle."""
    base = directory.resolve()
    for path in directory.rglob("*"):
        if path.is_symlink():
            if not path.resolve().is_relative_to(base) or not path.exists():
                raise ValueError("Dependency link escapes artifact: " + str(path))
        elif path.is_file():
            if path.name.startswith(".env") or path.suffix in (".pem", ".key", ".node"):
                raise ValueError("Private or native file in artifact: " + str(path))
            with path.open("rb") as stream:
                magic = stream.read(4)
            if magic in (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"MZ\x90\x00"):
                raise ValueError("Native binary requires Linux build: " + str(path))


def migration_hash(directory):
    digest = hashlib.sha256()
    for path in sorted(directory.rglob("*")):
        if path.is_file() and path.suffix in (".sql", ".json"):
            digest.update(path.relative_to(directory).as_posix().encode() + b"\0")
            digest.update(path.read_bytes())
    return digest.hexdigest()


def build(scope, bundle):
    if RADIO:
        run("pnpm", "install", "--frozen-lockfile", cwd=ROOT)
        run("pnpm", "--filter", "@haen/contracts", "build", cwd=ROOT)
        if scope != "frontend":
            run("pnpm", "--filter", "@haen/server", "typecheck", cwd=ROOT)
            run("pnpm", "exec", "vitest", "run", "--project", "server", cwd=ROOT)
            run("pnpm", "--filter", "@haen/server", "build", cwd=ROOT)
            run("pnpm", "--filter", "@haen/server", "--prod", "deploy", str(bundle / "server"), cwd=ROOT)
            shutil.copytree(ROOT / "apps/server/migrations", bundle / "server/migrations")
            portable(bundle / "server")
            (bundle / "migrations.sha256").write_text(migration_hash(ROOT / "apps/server/migrations") + "\n")
        if scope in ("frontend", "all"):
            run("pnpm", "--filter", "@haen/web", "typecheck", cwd=ROOT)
            run("pnpm", "exec", "vitest", "run", "--project", "web", cwd=ROOT)
            run("pnpm", "--filter", "@haen/web", "build", cwd=ROOT, env={**os.environ, "HAEN_WEB_BASE_PATH": "/radio/"})
            run("pnpm", "--filter", "@haen/web", "check:budget", cwd=ROOT)
            shutil.copytree(ROOT / "apps/web/dist", bundle / "web")
    else:
        if scope in ("backend", "all"):
            java = os.environ.get("JAVA_HOME")
            if shutil.which("/usr/libexec/java_home"):
                java = subprocess.check_output(["/usr/libexec/java_home", "-v", "25"], text=True).strip()
            env = {**os.environ, **({"JAVA_HOME": java, "PATH": java + "/bin:" + os.environ["PATH"]} if java else {})}
            run("mvn", "-B", "-f", "server/pom.xml", "clean", "verify", cwd=ROOT, env=env)
            shutil.copyfile(ROOT / "server/target/hahaen-ledger-server-1.0.0.jar", bundle / "app.jar")
            (bundle / "migrations.sha256").write_text(migration_hash(ROOT / "server/src/main/resources/db/migration") + "\n")
        if scope in ("h5", "all"):
            run("pnpm", "install", "--frozen-lockfile", cwd=ROOT / "app")
            run("pnpm", "run", "typecheck", cwd=ROOT / "app")
            run("pnpm", "run", "build:h5", cwd=ROOT / "app")
            shutil.copytree(ROOT / "app/dist/build/h5", bundle / "web")
    for name in ("Dockerfile", "compose.yaml", "deploy.sh"):
        shutil.copyfile(ROOT / "deploy/local" / name, bundle / name)


def source_clean():
    status = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], text=True)
    return not any(line for line in status.splitlines() if not line.endswith(".DS_Store"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=(*COMPONENTS, "all"))
    parser.add_argument("--host", default="hahaen-server")
    parser.add_argument("--build-only", action="store_true")
    args = parser.parse_args()
    # The host is passed as an argv element, never interpolated into a remote command.
    if not args.host or args.host.startswith("-") or any(c.isspace() for c in args.host):
        parser.error("Invalid SSH host")
    os.chdir(ROOT)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if not source_clean():
        parser.error("Commit source changes before publishing")
    with tempfile.TemporaryDirectory(prefix=PROJECT + "-release-") as temporary:
        work = Path(temporary)
        bundle = work / "bundle"
        bundle.mkdir()
        build(args.component, bundle)
        if not source_clean() or subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() != revision:
            parser.error("Source changed during build; rebuild the intended commit")
        if args.build_only:
            print("Local artifact build and validation passed")
            return
        archive = work / "release.tar.gz"
        with tarfile.open(archive, "w:gz", dereference=False) as output:
            for path in sorted(bundle.iterdir()):
                output.add(path, arcname=path.name, filter=lambda item: None if item.name.endswith(".DS_Store") else item)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        # One SSH session owns the temporary upload, extraction, lock and cleanup.
        remote = "set -eu; umask 077; d=$(mktemp -d /tmp/" + PROJECT + "-upload.XXXXXXXX); trap 'rm -rf -- \"$d\"' EXIT; cat > \"$d/release.tar.gz\"; echo '" + digest + "  '\"$d/release.tar.gz\" | sha256sum -c -; tar -xzf \"$d/release.tar.gz\" -C \"$d\"; bash \"$d/deploy.sh\" " + PROJECT + " " + args.component + " " + revision + " \"$d\""
        with archive.open("rb") as stream:
            run("ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", args.host, remote, stdin=stream)


if __name__ == "__main__":
    main()
