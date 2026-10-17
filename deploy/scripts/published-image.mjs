import assert from 'node:assert/strict';
export function verifyPublishedImage(image, native, reference, manifest, revision, targetPlatform) {
  assert.equal(native.Config.Labels['org.opencontainers.image.revision'], revision);
  assert.equal(native.Os + '/' + native.Architecture, targetPlatform);
  if (image.Descriptor) {
    assert.equal(image.Id, image.Descriptor.digest);
    assert.equal(native.Descriptor?.digest, reference.split('@')[1]);
    assert(
      [
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.v2+json',
      ].includes(native.Descriptor.mediaType),
    );
  } else assert.equal(manifest.config.digest, image.Id);
}
