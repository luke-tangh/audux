import argparse
import base64
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)


PRIVATE_KEY_ENV = "AUDUX_WHISPER_MANIFEST_PRIVATE_KEY"
PUBLIC_KEY_ENV = "AUDUX_WHISPER_MANIFEST_PUBLIC_KEY"


def sign_manifest_bytes(manifest: bytes, private_key_pem: bytes) -> bytes:
    key = serialization.load_pem_private_key(private_key_pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("Whisper manifest signing key must be an Ed25519 private key")
    return base64.b64encode(key.sign(manifest)) + b"\n"


def sign_and_verify_manifest_bytes(
    manifest: bytes,
    private_key_pem: bytes,
    public_key_pem: bytes,
) -> bytes:
    encoded_signature = sign_manifest_bytes(manifest, private_key_pem)
    public_key = serialization.load_pem_public_key(public_key_pem)
    if not isinstance(public_key, Ed25519PublicKey):
        raise ValueError("Whisper manifest verification key must be Ed25519")
    public_key.verify(base64.b64decode(encoded_signature), manifest)
    return encoded_signature


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sign an Audux Whisper component manifest with Ed25519."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    private_key = os.getenv(PRIVATE_KEY_ENV, "").strip()
    if not private_key:
        raise RuntimeError(f"{PRIVATE_KEY_ENV} is required")
    public_key_pem = os.getenv(PUBLIC_KEY_ENV, "").strip()
    if not public_key_pem:
        raise RuntimeError(f"{PUBLIC_KEY_ENV} is required")

    output = args.output or args.manifest.with_name(args.manifest.name + ".sig")
    manifest = args.manifest.read_bytes()
    encoded_signature = sign_and_verify_manifest_bytes(
        manifest,
        private_key.encode("utf-8"),
        public_key_pem.encode("utf-8"),
    )
    output.write_bytes(encoded_signature)
    print(f"Whisper component manifest signature generated: {output}")


if __name__ == "__main__":
    main()
