// Service label for the Brother QL-600 label printer, as a P-touch Editor
// .lbx file. An .lbx is a ZIP holding label.xml (the layout) and prop.xml
// (metadata). Rather than generate Brother's layout XML from scratch, we
// take a template designed in P-touch Editor (print-templates/) — so the
// roll, label size, fonts and positions are whatever the shop set there —
// and only swap the placeholder text boxes ({shop}, {order}, {issue},
// {password}) for the ticket's values.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEMPLATE_PATH = path.join(__dirname, 'print-templates', 'service-label.lbx');

// ---- Minimal ZIP read/write (only what .lbx files need) ----

function readZip(buf) {
  // The End Of Central Directory record sits at the very end (after an
  // optional comment), so search backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip method ${method}`);
    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

function writeZip(entries) {
  const { time, date } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);      // version needed
    local.writeUInt16LE(0, 6);       // flags
    local.writeUInt16LE(8, 8);       // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);      // extra length
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);    // version made by
    central.writeUInt16LE(20, 6);    // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// ---- Filling the template ----

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Placeholder names are matched case-insensitively; "pasword" is accepted
// too since the shop's first template was saved with that spelling.
function placeholderValues(ticket, shopName) {
  const password = ticket.phone_password ? `Парола: ${ticket.phone_password}` : '';
  return {
    shop: shopName || '',
    order: `№ ${ticket.ticket_no}`,
    // P-touch Editor's own line-break encoding isn't something we can rely
    // on here, so a multi-line description is printed as one line.
    issue: String(ticket.description || '').replace(/\s*[\r\n]+\s*/g, ' ').trim(),
    password,
    pasword: password
  };
}

// Each text box is a <text:text> element: its content in <pt:data>, then
// one <text:stringItem charLen="N"> per run of same-styled characters,
// whose lengths must add up to the text length. P-touch Editor splits even
// a plain "{shop}" into several runs, so we collapse them into one run
// (keeping the first run's font) sized to the new text.
function fillLabelXml(xml, values) {
  return xml.replace(/<text:text>[\s\S]*?<\/text:text>/g, block => {
    const m = block.match(/<pt:data>\{(\w+)\}<\/pt:data>/);
    if (!m) return block;
    const key = m[1].toLowerCase();
    if (!(key in values)) return block;
    const value = values[key];
    // An empty field (e.g. no unlock code) drops the whole text box.
    if (!value) return '';

    const items = block.match(/<text:stringItem charLen="\d+">[\s\S]*?<\/text:stringItem>/g) || [];
    const oneItem = items.length
      ? items[0].replace(/charLen="\d+"/, `charLen="${value.length}"`)
      : '';
    const firstItemAt = items.length ? block.indexOf(items[0]) : -1;
    let out = block;
    if (items.length) {
      const lastItem = items[items.length - 1];
      const end = block.lastIndexOf(lastItem) + lastItem.length;
      out = block.slice(0, firstItemAt) + oneItem + block.slice(end);
    }
    return out.replace(m[0], `<pt:data>${escapeXml(value)}</pt:data>`);
  });
}

function buildServiceLabel(ticket, shopName, templatePath = TEMPLATE_PATH) {
  // Read on every request so a re-saved template is picked up without a restart.
  const entries = readZip(fs.readFileSync(templatePath));
  const values = placeholderValues(ticket, shopName);
  for (const e of entries) {
    if (e.name === 'label.xml') e.data = Buffer.from(fillLabelXml(e.data.toString('utf8'), values), 'utf8');
  }
  return writeZip(entries);
}

module.exports = { buildServiceLabel, readZip, writeZip, fillLabelXml, TEMPLATE_PATH };
