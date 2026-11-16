import { BadRequestException } from '@nestjs/common';
import { contactFor, resolveOrderReceiver } from './order-receiver';

describe('resolveOrderReceiver', () => {
  it('is null when neither is sent (the customer is the receiver)', () => {
    expect(resolveOrderReceiver({})).toBeNull();
    expect(resolveOrderReceiver({ receiverName: null, receiverPhone: null })).toBeNull();
  });
  it('treats blank values as absent', () => {
    expect(resolveOrderReceiver({ receiverName: '  ', receiverPhone: '' })).toBeNull();
  });
  it('trims and returns the pair', () => {
    expect(
      resolveOrderReceiver({ receiverName: '  Sara ', receiverPhone: ' 0501234567 ' }),
    ).toEqual({ name: 'Sara', phone: '0501234567' });
  });
  it('rejects one without the other', () => {
    expect(() => resolveOrderReceiver({ receiverName: 'Sara' })).toThrow(BadRequestException);
    expect(() => resolveOrderReceiver({ receiverPhone: '0501234567' })).toThrow(BadRequestException);
  });
});

describe('contactFor', () => {
  const base = { customerName: 'Omar', customerPhone: '0500000000' };
  it('falls back to the customer', () => {
    expect(contactFor(base)).toEqual({ name: 'Omar', phone: '0500000000', isReceiver: false });
    expect(contactFor({ ...base, receiverName: 'Sara', receiverPhone: null }).isReceiver).toBe(false);
  });
  it('uses the receiver when both are set', () => {
    expect(contactFor({ ...base, receiverName: 'Sara', receiverPhone: '0501111111' })).toEqual({
      name: 'Sara',
      phone: '0501111111',
      isReceiver: true,
    });
  });
});
