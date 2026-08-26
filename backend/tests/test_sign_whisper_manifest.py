import base64

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from sign_whisper_manifest import sign_and_verify_manifest_bytes, sign_manifest_bytes


def test_sign_manifest_bytes_produces_verifiable_ed25519_signature() -> None:
    private_key = Ed25519PrivateKey.generate()
    private_key_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    manifest = b'{"schema_version":1}\n'

    signature = base64.b64decode(sign_manifest_bytes(manifest, private_key_pem))

    private_key.public_key().verify(signature, manifest)


def test_sign_manifest_bytes_rejects_non_ed25519_key() -> None:
    public_key = Ed25519PrivateKey.generate().public_key()
    public_key_pem = public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    with pytest.raises((TypeError, ValueError)):
        sign_manifest_bytes(b"manifest", public_key_pem)


def test_sign_and_verify_rejects_mismatched_key_pair() -> None:
    private_key = Ed25519PrivateKey.generate()
    private_key_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    unrelated_public_key_pem = Ed25519PrivateKey.generate().public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    with pytest.raises(InvalidSignature):
        sign_and_verify_manifest_bytes(
            b"manifest",
            private_key_pem,
            unrelated_public_key_pem,
        )
