using System;
using System.Security.Cryptography;
using System.Text;
using System.Linq;

namespace WhisprDesktop
{
    public class CryptoHelper
    {
        // P-256 (prime256v1) for ECDH
        public static ECDiffieHellman GenerateECDHKeyPair()
        {
            return ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        }

        public static byte[] ExportPublicKey(ECDiffieHellman ecdh)
        {
            var p = ecdh.ExportParameters(false);
            var raw = new byte[65];
            raw[0] = 0x04; // Uncompressed point indicator
            Buffer.BlockCopy(p.Q.X, 0, raw, 1, 32);
            Buffer.BlockCopy(p.Q.Y, 0, raw, 33, 32);
            return raw;
        }

        /// <summary>
        /// Derives the shared secret matching Web Crypto API's deriveKey(ECDH → AES-GCM 256) exactly.
        /// Web Crypto uses the raw 32-byte X-coordinate of the shared EC point as the AES key.
        /// No hashing or HKDF is applied.
        /// </summary>
        public static byte[] DeriveSharedSecret(ECDiffieHellman myKey, byte[] otherPublicKeyBlob)
        {
            using (var otherKey = ECDiffieHellman.Create())
            {
                var ecParams = new ECParameters
                {
                    Curve = ECCurve.NamedCurves.nistP256,
                    Q = new ECPoint
                    {
                        X = otherPublicKeyBlob.Skip(1).Take(32).ToArray(),
                        Y = otherPublicKeyBlob.Skip(33).Take(32).ToArray()
                    }
                };
                otherKey.ImportParameters(ecParams);

                // DeriveRawSecretAgreement returns the raw X-coordinate of the shared EC point.
                // This is EXACTLY what Web Crypto's deriveKey(ECDH, {name:"AES-GCM",length:256}) uses.
                // DeriveKeyMaterial() would apply SHA-256 — which BREAKS interop.
                return myKey.DeriveRawSecretAgreement(otherKey.PublicKey);
            }
        }

        public static byte[] EncryptAESGCM(byte[] data, byte[] key, out byte[] iv)
        {
            iv = new byte[12];
            RandomNumberGenerator.Fill(iv);

            byte[] tag = new byte[16];
            byte[] ciphertext = new byte[data.Length];

            using (var aes = new AesGcm(key, tag.Length))
            {
                aes.Encrypt(iv, data, ciphertext, tag);
            }

            // Concatenate: IV + Ciphertext + Tag
            byte[] result = new byte[iv.Length + ciphertext.Length + tag.Length];
            Buffer.BlockCopy(iv, 0, result, 0, iv.Length);
            Buffer.BlockCopy(ciphertext, 0, result, iv.Length, ciphertext.Length);
            Buffer.BlockCopy(tag, 0, result, iv.Length + ciphertext.Length, tag.Length);
            
            return result;
        }

        public static byte[] DecryptAESGCM(byte[] encryptedDataWithIvAndTag, byte[] key)
        {
            int ivSize = 12;
            int tagSize = 16;
            int cipherSize = encryptedDataWithIvAndTag.Length - ivSize - tagSize;
            
            byte[] iv = new byte[ivSize];
            byte[] ciphertext = new byte[cipherSize];
            byte[] tag = new byte[tagSize];
            
            Buffer.BlockCopy(encryptedDataWithIvAndTag, 0, iv, 0, ivSize);
            Buffer.BlockCopy(encryptedDataWithIvAndTag, ivSize, ciphertext, 0, cipherSize);
            Buffer.BlockCopy(encryptedDataWithIvAndTag, ivSize + cipherSize, tag, 0, tagSize);

            byte[] plaintext = new byte[cipherSize];

            using (var aes = new AesGcm(key, tagSize))
            {
                aes.Decrypt(iv, ciphertext, tag, plaintext);
            }

            return plaintext;
        }

        // Overload for when IV is already separated (e.g. parsed from JSON payload)
        public static byte[] DecryptAESGCM(byte[] encryptedDataWithTag, byte[] key, byte[] iv)
        {
            int tagSize = 16;
            int cipherSize = encryptedDataWithTag.Length - tagSize;
            
            byte[] ciphertext = new byte[cipherSize];
            byte[] tag = new byte[tagSize];
            
            Buffer.BlockCopy(encryptedDataWithTag, 0, ciphertext, 0, cipherSize);
            Buffer.BlockCopy(encryptedDataWithTag, cipherSize, tag, 0, tagSize);

            byte[] plaintext = new byte[cipherSize];

            using (var aes = new AesGcm(key, tagSize))
            {
                aes.Decrypt(iv, ciphertext, tag, plaintext);
            }

            return plaintext;
        }

        public static byte[] DerivePBKDF2Key(string password, string saltString)
        {
            byte[] salt = Encoding.UTF8.GetBytes(saltString);
            using (var deriveBytes = new Rfc2898DeriveBytes(password, salt, 100000, HashAlgorithmName.SHA256))
            {
                return deriveBytes.GetBytes(32); // 256-bit key for AES-GCM wrapping
            }
        }
    }
}
