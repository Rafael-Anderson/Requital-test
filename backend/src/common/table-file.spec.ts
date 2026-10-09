import { deflateRawSync } from 'zlib';
import { BadRequestException } from '@nestjs/common';
import { buildXlsx, buildZip } from '../../test/helpers/xlsx-fixture';
import { readTable } from './table-file';
import { readXlsxRows, XlsxError } from './xlsx-reader';

const file = (name: string, content: string | Buffer) => ({
  originalname: name,
  buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'),
});

describe('readTable csv', () => {
  it('reads a comma file with a BOM and trims headers and cells', () => {
    const t = readTable(file('a.csv', '\ufeff Name ,Price\n Rose ,10.505\n'), {
      allowXlsx: true,
    });
    expect(t.headers).toEqual(['Name', 'Price']);
    expect(t.rows).toEqual([{ Name: 'Rose', Price: '10.505' }]);
  });

  it('detects semicolon and tab separators', () => {
    expect(
      readTable(file('a.csv', 'a;b\n1;2\n'), { allowXlsx: true }).rows,
    ).toEqual([{ a: '1', b: '2' }]);
    expect(
      readTable(file('a.csv', 'a\tb\n1\t2\n'), { allowXlsx: true }).rows,
    ).toEqual([{ a: '1', b: '2' }]);
  });

  it('keeps Arabic text exactly', () => {
    const t = readTable(file('a.csv', 'اسم المنتج,السعر\nباقة ورد,١٠٫٥\n'), {
      allowXlsx: true,
    });
    expect(t.rows[0]['اسم المنتج']).toBe('باقة ورد');
    expect(t.rows[0]['السعر']).toBe('١٠٫٥');
  });

  it('refuses a non-UTF-8 file with advice rather than importing mojibake', () => {
    const cp1256 = Buffer.from([
      0xc7, 0xdf, 0xe3, 0x2c, 0xc7, 0x0a, 0x31, 0x2c, 0x32,
    ]);
    expect(() => readTable(file('a.csv', cp1256), { allowXlsx: true })).toThrow(
      /UTF-8/,
    );
  });

  it('refuses other extensions and xlsx where it is not allowed', () => {
    expect(() => readTable(file('a.txt', 'a'), { allowXlsx: true })).toThrow(
      BadRequestException,
    );
    expect(() =>
      readTable(file('a.xlsx', buildXlsx([['a'], ['1']])), {
        allowXlsx: false,
      }),
    ).toThrow(/Only .csv/);
  });
});

describe('readTable xlsx', () => {
  it('reads strings, numbers, empty cells, Arabic and XML entities', () => {
    const buf = buildXlsx([
      ['اسم المنتج', 'السعر', 'Notes', 'Sku'],
      ['باقة <ورد> & هدية', 150.5, null, 'A-1'],
      ['', '', '', ''],
      ['Second', 20, 'x', null],
    ]);
    const t = readTable(file('p.xlsx', buf), { allowXlsx: true });
    expect(t.format).toBe('xlsx');
    expect(t.headers).toEqual(['اسم المنتج', 'السعر', 'Notes', 'Sku']);
    expect(t.rows).toEqual([
      {
        'اسم المنتج': 'باقة <ورد> & هدية',
        السعر: '150.5',
        Notes: '',
        Sku: 'A-1',
      },
      { 'اسم المنتج': 'Second', السعر: '20', Notes: 'x', Sku: '' },
    ]);
  });

  it('handles stored (uncompressed) entries and inline strings', () => {
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Rose &#x1F339;</t></is></c></row></sheetData></worksheet>';
    const buf = buildZip([
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from(sheet),
        deflate: false,
      },
    ]);
    expect(readXlsxRows(buf)).toEqual([['Name'], ['Rose \u{1F339}']]);
  });

  it('rejects garbage, a truncated zip and an encrypted entry', () => {
    expect(() => readXlsxRows(Buffer.from('hello world'))).toThrow(XlsxError);
    const good = buildXlsx([['a'], ['b']]);
    expect(() => readXlsxRows(good.subarray(0, good.length - 30))).toThrow(
      XlsxError,
    );
    const enc = Buffer.from(good);
    const cd = enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const nameAt = enc.indexOf(Buffer.from('xl/worksheets/sheet1.xml'), cd);
    enc.writeUInt16LE(1, nameAt - 46 + 8); // general purpose flag: encrypted
    expect(() => readXlsxRows(enc)).toThrow(/Encrypted/);
  });

  it('stops a zip bomb: a header that lies about the size is cut at the cap', () => {
    // 40MB of zeros deflates to ~40KB. The central directory claims 1KB.
    const bomb = deflateRawSync(Buffer.alloc(40 * 1024 * 1024));
    const name = Buffer.from('xl/worksheets/sheet1.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(bomb.length, 18);
    local.writeUInt32LE(1024, 22);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(bomb.length, 20);
    cd.writeUInt32LE(1024, 24); // the lie
    cd.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    const body = Buffer.concat([local, name, bomb]);
    eocd.writeUInt32LE(cd.length + name.length, 12);
    eocd.writeUInt32LE(body.length, 16);
    const file2 = Buffer.concat([body, cd, name, eocd]);
    expect(() => readXlsxRows(file2)).toThrow(XlsxError);
  });

  it('refuses an entry whose declared size is over the cap without inflating it', () => {
    const buf = buildXlsx([['a'], ['b']]);
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const nameAt = buf.indexOf(Buffer.from('xl/worksheets/sheet1.xml'), cd);
    buf.writeUInt32LE(100 * 1024 * 1024, nameAt - 46 + 24);
    expect(() => readXlsxRows(buf)).toThrow(/too large/);
  });
});
