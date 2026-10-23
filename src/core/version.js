'use strict';
// fuxaw sürümü dört parçalıdır (ör. 26.1.10.22, etiket V26.1.10.22). npm, Electron ve güncelleyici
// üç parçalı semver ister; güncelleyici sürümleri semver ile karşılaştırdığı için aynı ayın iki sürümü
// (26.1.10.14, 26.1.10.22) farklı ve sıralı olmalı: üçüncü parça = 3. parça × 1000 + 4. parça.
//   26.1.10.22 ↔ 26.1.10022     26.1.11.1 ↔ 26.1.11001
// Ekranda, dosya adlarında ve etikette hep dört parçalı hal görünür.

const FULL = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
const STEP = 1000;

/** 26.1.10.22 → 26.1.10022 */
function toSemver(full) {
  const m = FULL.exec(String(full).replace(/^[vV]/, ''));
  if (!m) throw new Error(`sürüm dört sayısal parça olmalı: ${full}`);
  const [, a, b, c, d] = m.map(Number);
  if (d >= STEP) throw new Error(`son parça ${STEP}'den küçük olmalı: ${full}`);
  return `${a}.${b}.${c * STEP + d}`;
}

/** 26.1.10022 → 26.1.10.22; eski üç parçalı sürümler (26.1.10) olduğu gibi döner. */
function fromSemver(semver) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(semver));
  if (!m) return String(semver);
  const [, a, b, c] = m.map(Number);
  return c < STEP ? `${a}.${b}.${c}` : `${a}.${b}.${Math.floor(c / STEP)}.${c % STEP}`;
}

module.exports = { toSemver, fromSemver };
