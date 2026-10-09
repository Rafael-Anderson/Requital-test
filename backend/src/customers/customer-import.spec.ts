import {
  CustomerColumnsError,
  maskPhone,
  normaliseCustomerPhone,
  parseCustomerRows,
  planCustomerImport,
  type ExistingCustomer,
} from './customer-import';

function run(
  table: string[][],
  existing: Record<string, ExistingCustomer[]> = {},
  onExisting: 'update' | 'skip' = 'update',
  country: string | null = 'AE',
) {
  const [header, ...data] = table;
  const rows = data.map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])),
  );
  const parsed = parseCustomerRows(rows, header, country);
  return {
    parsed,
    plans: planCustomerImport(
      parsed.rows,
      new Map(Object.entries(existing)),
      onExisting,
    ),
  };
}
const cust = (
  id: number,
  name: string,
  email: string | null = null,
  addresses: { address?: string }[] = [],
) => ({
  id,
  name,
  email,
  addresses,
});

describe('normaliseCustomerPhone', () => {
  it.each([
    ['0501234567', 'AE', '+971501234567'],
    ['050 123 4567', 'AE', '+971501234567'],
    ['+971 50 123 4567', 'AE', '+971501234567'],
    ['00971501234567', 'AE', '+971501234567'],
    ['971501234567', 'AE', '+971501234567'],
    ['501234567', 'AE', '+971501234567'],
    ['(050) 123-4567', 'AE', '+971501234567'],
    ['٠٥٠١٢٣٤٥٦٧', 'AE', '+971501234567'],
    ['0551234567', 'SA', '+966551234567'],
    ['55123456', 'KW', '+96555123456'],
    ['0501234567', null, '+971501234567'],
  ])('%s (%s) -> %s', (raw, country, expected) => {
    expect(normaliseCustomerPhone(raw, country)).toBe(expected);
  });

  it.each([
    '',
    'abc',
    '12',
    '050-ABC-4567',
    '9.71501234567E11',
    '+',
    '0'.repeat(30),
  ])('rejects %p', (raw) => {
    expect(normaliseCustomerPhone(raw, 'AE')).toBeNull();
  });

  it('masks all but the head and the last two digits', () => {
    expect(maskPhone('+971501234567')).toBe('+971•••••••67');
  });
});

describe('parseCustomerRows', () => {
  it('refuses a file without name and phone columns, naming them', () => {
    expect(() => parseCustomerRows([{ x: '1' }], ['x'], 'AE')).toThrow(
      CustomerColumnsError,
    );
    try {
      parseCustomerRows([{ x: '1' }], ['x'], 'AE');
    } catch (e) {
      expect((e as CustomerColumnsError).missing).toEqual(['name', 'phone']);
    }
  });

  it('reads English and Arabic headers, drops a bad email with a warning', () => {
    const parsed = parseCustomerRows(
      [
        {
          'اسم العميل': 'سارة',
          'رقم الجوال': '٠٥٠١٢٣٤٥٦٧',
          'البريد الالكتروني': 'nope',
          العنوان: 'دبي',
        },
      ],
      ['اسم العميل', 'رقم الجوال', 'البريد الالكتروني', 'العنوان'],
      'AE',
    );
    const [r] = parsed.rows;
    expect(r.name).toBe('سارة');
    expect(r.phone).toBe('+971501234567');
    expect(r.email).toBeNull();
    expect(r.warnings.join()).toMatch(/Email is not valid/);
    expect(r.address?.address).toBe('دبي');
  });

  it('ignores a marketing column, says so, and reports notes as not imported', () => {
    const parsed = parseCustomerRows(
      [
        {
          name: 'A',
          phone: '0501234567',
          'Accepts Marketing': 'yes',
          Notes: 'vip',
        },
      ],
      ['name', 'phone', 'Accepts Marketing', 'Notes'],
      'AE',
    );
    expect(parsed.warnings.join()).toMatch(/never subscribes/);
    expect(parsed.unsupportedColumns).toEqual(['Accepts Marketing', 'Notes']);
    // No consent-like field exists on the parsed row.
    expect(Object.keys(parsed.rows[0]).join()).not.toMatch(
      /consent|marketing|subscri/i,
    );
  });

  it('never echoes a phone or email in an error or warning', () => {
    const parsed = parseCustomerRows(
      [{ name: '', phone: 'not-a-phone-9876', email: 'secret@example.com' }],
      ['name', 'phone', 'email'],
      'AE',
    );
    const text = [...parsed.rows[0].errors, ...parsed.rows[0].warnings].join(
      ' ',
    );
    expect(text).not.toMatch(/9876|secret|example\.com/);
  });
});

describe('planCustomerImport', () => {
  it('creates a new customer stored as E.164', () => {
    const { plans } = run([
      ['name', 'phone', 'email'],
      ['Sara', '050 123 4567', 'sara@x.test'],
    ]);
    expect(plans[0]).toMatchObject({
      action: 'create',
      phone: '+971501234567',
      setEmail: 'sara@x.test',
      phoneMasked: '+971•••••••67',
    });
  });

  it('the same phone in two spellings in the file is ONE person', () => {
    const { plans } = run([
      ['name', 'phone'],
      ['Sara', '0501234567'],
      ['sara', '+971 50 123 4567'],
    ]);
    expect(plans.map((p) => p.action)).toEqual(['create', 'skip']);
    expect(plans[1].reason).toBe('Same person as row 2');
  });

  it('the same phone with different names is a conflict and imports neither', () => {
    const { plans } = run([
      ['name', 'phone'],
      ['Sara', '0501234567'],
      ['Mona', '971501234567'],
      ['Other', '0509999999'],
    ]);
    expect(plans.map((p) => p.action)).toEqual([
      'conflict',
      'conflict',
      'create',
    ]);
    expect(plans[0].reason).toMatch(/Rows 2, 3/);
  });

  it('two rows for one phone with different emails conflict, one blank email does not', () => {
    const conflict = run([
      ['name', 'phone', 'email'],
      ['Sara', '0501234567', 'a@x.test'],
      ['Sara', '0501234567', 'b@x.test'],
    ]);
    expect(conflict.plans.map((p) => p.action)).toEqual([
      'conflict',
      'conflict',
    ]);
    const merge = run([
      ['name', 'phone', 'email'],
      ['Sara', '0501234567', ''],
      ['Sara', '0501234567', 'a@x.test'],
    ]);
    expect(merge.plans.map((p) => p.action)).toEqual(['create', 'skip']);
    expect(merge.plans[0].setEmail).toBe('a@x.test');
  });

  it('matches an existing customer stored in a DIFFERENT spelling and creates nothing', () => {
    // The stored row ("050 123 4567") normalises to the same E.164 as the file's.
    const { plans } = run(
      [
        ['name', 'phone'],
        ['Sara', '+971501234567'],
      ],
      { '+971501234567': [cust(7, 'Sara')] },
      'skip',
    );
    expect(plans[0]).toMatchObject({ action: 'skip', existingId: 7 });
  });

  it('update only fills gaps: empty email and a missing address, never name or email', () => {
    const { plans } = run(
      [
        ['name', 'phone', 'email', 'address'],
        ['Different Name', '0501234567', 'new@x.test', 'Villa 5'],
        ['Different Name', '0502222222', 'new@x.test', 'Villa 5'],
        ['Sara', '0503333333', '', 'Villa 5'],
      ],
      {
        '+971501234567': [cust(1, 'Sara', null, [])],
        '+971502222222': [
          cust(2, 'Sara', 'old@x.test', [{ address: 'villa 5' }]),
        ],
        '+971503333333': [cust(3, 'Sara', null, [{ address: 'villa 5' }])],
      },
    );
    expect(plans[0]).toMatchObject({
      action: 'update',
      setEmail: 'new@x.test',
    });
    expect(plans[0].changes).toEqual(['Email', 'Address']);
    expect(plans[0].warnings).toContain('The existing name was kept');
    expect(plans[1].action).toBe('skip'); // address already there, email kept
    expect(plans[1].warnings).toContain('The existing email was kept');
    expect(plans[1].setEmail).toBeNull();
    expect(plans[2]).toMatchObject({ action: 'skip', reason: 'No changes' });
  });

  it('several existing rows sharing one normalised phone are a conflict', () => {
    const { plans } = run(
      [
        ['name', 'phone'],
        ['Sara', '0501234567'],
      ],
      { '+971501234567': [cust(1, 'Sara'), cust(2, 'Sara')] },
    );
    expect(plans[0].action).toBe('conflict');
    expect(plans[0].reason).toMatch(/2 existing customers/);
  });

  it('flags rows with a missing or invalid phone or name as errors', () => {
    const { plans } = run([
      ['name', 'phone'],
      ['A', ''],
      ['B', 'xyz'],
      ['', '0501234567'],
    ]);
    expect(plans.map((p) => p.action)).toEqual(['error', 'error', 'error']);
  });

  it('keeps Arabic names exactly', () => {
    const { plans } = run([
      ['name', 'phone'],
      ['سارة محمد', '0501234567'],
    ]);
    expect(plans[0].name).toBe('سارة محمد');
  });
});
