// @ts-check

export const calcCRC32 = (function () {
  // CRC32 source https://stackoverflow.com/a/18639999

  /**
 * @param {string | null | undefined} str
 */
  function calcCRC32(str) {
    if (!str) return 0;
    if (!crcTable) crcTable = makeCRCTable();
    var crc = 0 ^ (-1);

    for (var i = 0; i < str.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
    }

    return (crc ^ (-1)) >>> 0;
  }

  let crcTable;
  function makeCRCTable() {
    var c;
    var crcTable = [];
    for (var n = 0; n < 256; n++) {
      c = n;
      for (var k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      crcTable[n] = c;
    }
    return crcTable;
  }

  return calcCRC32;
})();