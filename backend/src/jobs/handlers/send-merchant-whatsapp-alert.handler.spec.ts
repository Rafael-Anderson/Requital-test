import { handleSendMerchantWhatsAppAlertJob } from './send-merchant-whatsapp-alert.handler';
import * as whatsapp from '../../common/whatsapp';

describe('handleSendMerchantWhatsAppAlertJob', () => {
  it('calls sendPlatformWhatsAppAlertOrThrow with the payload to/body', async () => {
    const spy = jest
      .spyOn(whatsapp, 'sendPlatformWhatsAppAlertOrThrow')
      .mockResolvedValue(undefined);

    await handleSendMerchantWhatsAppAlertJob({
      to: '+971501234567',
      body: 'New order #42 from Jane Doe. Total: 120 AED.',
      orderId: 42,
    });

    expect(spy).toHaveBeenCalledWith(
      '+971501234567',
      'New order #42 from Jane Doe. Total: 120 AED.',
    );
    spy.mockRestore();
  });

  it('propagates a failure so the queue can retry it', async () => {
    const spy = jest
      .spyOn(whatsapp, 'sendPlatformWhatsAppAlertOrThrow')
      .mockRejectedValue(new Error('WhatsApp API down'));

    await expect(
      handleSendMerchantWhatsAppAlertJob({
        to: '+971501234567',
        body: 'New order #42',
        orderId: 42,
      }),
    ).rejects.toThrow('WhatsApp API down');
    spy.mockRestore();
  });
});
