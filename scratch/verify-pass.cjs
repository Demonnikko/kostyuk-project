const crypto = require('crypto');

const stored = "scrypt:3cf0294af7d89cfd86ae2d6390db6392:222f57255c4b99949851fde151ab218a00f02807b8d4607381ff6977d9b13c7d9a1d33764fa548e312e77beff32e6816cd7e81258b5490059ba6c600832e6384";
const plaintext = "Dikost90";

const parts = stored.split(':');
const [, salt, hash] = parts;
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = { N: 16384, r: 8, p: 1 };

crypto.scrypt(plaintext, salt, SCRYPT_KEYLEN, SCRYPT_COST, (err, key) => {
  if (err) throw err;
  const expectedBuf = Buffer.from(hash, 'hex');
  const actualBuf = key;
  console.log("Match?", crypto.timingSafeEqual(expectedBuf, actualBuf));
});
