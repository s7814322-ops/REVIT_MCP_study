import fs from 'node:fs';

// Read compound-file streams without loading families into Revit.
export function readCompound(path, streamNames = null) {
  const file = fs.readFileSync(path);
  if (file.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new Error('Invalid compound file');
  const sectorSize = 2 ** file.readUInt16LE(30);
  const miniSize = 2 ** file.readUInt16LE(32);
  const sector = id => file.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  const difat = [];
  for (let offset = 76; offset < 512; offset += 4) {
    const id = file.readUInt32LE(offset);
    if (id < 0xfffffffa) difat.push(id);
  }
  let next = file.readUInt32LE(68);
  for (let index = 0; index < file.readUInt32LE(72) && next < 0xfffffffa; index++) {
    const block = sector(next);
    for (let offset = 0; offset < sectorSize - 4; offset += 4) {
      const id = block.readUInt32LE(offset);
      if (id < 0xfffffffa) difat.push(id);
    }
    next = block.readUInt32LE(sectorSize - 4);
  }
  const fat = [];
  for (const id of difat) {
    const block = sector(id);
    for (let offset = 0; offset < block.length; offset += 4) fat.push(block.readUInt32LE(offset));
  }
  function chain(start, table, getSector) {
    const blocks = [];
    const seen = new Set();
    for (let id = start; id < 0xfffffffa; id = table[id]) {
      if (seen.has(id) || id === undefined) throw new Error('Invalid sector chain');
      seen.add(id);
      blocks.push(getSector(id));
    }
    return Buffer.concat(blocks);
  }
  const directory = chain(file.readUInt32LE(48), fat, sector);
  const entries = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const block = directory.subarray(offset, offset + 128);
    const nameLength = block.readUInt16LE(64);
    if (!nameLength) continue;
    entries.push({
      name: block.subarray(0, nameLength - 2).toString('utf16le'),
      type: block[66], start: block.readUInt32LE(116),
      size: Number(block.readBigUInt64LE(120)),
    });
  }
  const root = entries.find(entry => entry.type === 5);
  const miniStream = chain(root.start, fat, sector).subarray(0, root.size);
  const miniFatBytes = chain(file.readUInt32LE(60), fat, sector);
  const miniFat = [];
  for (let offset = 0; offset < miniFatBytes.length; offset += 4) miniFat.push(miniFatBytes.readUInt32LE(offset));
  return entries.filter(entry => entry.type === 2 && (!streamNames || streamNames.includes(entry.name))).map(entry => ({
    name: entry.name,
    data: (entry.size < file.readUInt32LE(56)
      ? chain(entry.start, miniFat, id => miniStream.subarray(id * miniSize, (id + 1) * miniSize))
      : chain(entry.start, fat, sector)).subarray(0, entry.size),
  }));
}
