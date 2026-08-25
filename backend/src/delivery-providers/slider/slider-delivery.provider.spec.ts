import { HttpException } from '@nestjs/common';
import { SliderDeliveryProvider } from './slider-delivery.provider';
import type { DeliveryProviderCredentials } from './slider-delivery.interface';

const credentials: DeliveryProviderCredentials = {
  apiKey: 'sk_test',
  accountId: 'acct_1',
  baseUrl: 'https://api-sandbox.slider-app.com/v1',
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('SliderDeliveryProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('getQuote', () => {
    it('maps the fare response to camelCase', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          distance_km: 12.5,
          duration_minutes: 20,
          vehicles: [
            {
              vehicle_type: 'bike',
              delivery_fee: 15,
              is_available: true,
              unavailable_reason: null,
            },
            {
              vehicle_type: 'car',
              delivery_fee: 25,
              is_available: false,
              unavailable_reason: 'no cars nearby',
            },
          ],
        }),
      );

      const provider = new SliderDeliveryProvider();
      const quote = await provider.getQuote({
        pickup: { latitude: 25.2, longitude: 55.3 },
        delivery: { latitude: 25.1, longitude: 55.2 },
        credentials,
      });

      expect(quote).toEqual({
        distanceKm: 12.5,
        durationMinutes: 20,
        vehicles: [
          {
            vehicleType: 'bike',
            deliveryFee: 15,
            isAvailable: true,
            unavailableReason: null,
          },
          {
            vehicleType: 'car',
            deliveryFee: 25,
            isAvailable: false,
            unavailableReason: 'no cars nearby',
          },
        ],
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/deliveries/fare'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Slider-Key': 'sk_test' }),
        }),
      );
    });
  });

  describe('createDelivery', () => {
    it('maps the create response to camelCase', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(201, {
          order_number: 999,
          status: 'searching_rider',
          fare: 15,
          currency: 'AED',
          distance_km: 12.5,
          tracking_url: 'https://track.slider-app.com/999',
          created_at: '2026-08-25T10:00:00Z',
        }),
      );

      const provider = new SliderDeliveryProvider();
      const result = await provider.createDelivery({
        orderId: 42,
        vehicleType: 'bike',
        scheduleAt: null,
        pickup: {
          address: 'Outlet A',
          latitude: 25.2,
          longitude: 55.3,
          contactNumber: '+971500000000',
        },
        dropoff: {
          address: 'Customer St',
          latitude: 25.1,
          longitude: 55.2,
          contactNumber: '+971500000001',
        },
        credentials,
      });

      expect(result).toEqual({
        orderNumber: 999,
        status: 'searching_rider',
        fee: 15,
        currency: 'AED',
        distanceKm: 12.5,
        trackingUrl: 'https://track.slider-app.com/999',
        createdAt: '2026-08-25T10:00:00Z',
      });
    });

    it('retries once on a 5xx response, then succeeds', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(500, { message: 'temporary' }))
        .mockResolvedValueOnce(
          jsonResponse(201, {
            order_number: 1,
            status: 'searching_rider',
            fare: 10,
            currency: 'AED',
            distance_km: 1,
            tracking_url: 'https://x',
            created_at: '2026-08-25T10:00:00Z',
          }),
        );

      const provider = new SliderDeliveryProvider();
      const result = await provider.createDelivery({
        orderId: 1,
        vehicleType: 'any',
        scheduleAt: null,
        pickup: { address: 'A', latitude: 1, longitude: 1, contactNumber: '1' },
        dropoff: {
          address: 'B',
          latitude: 2,
          longitude: 2,
          contactNumber: '2',
        },
        credentials,
      });

      expect(result.orderNumber).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry on a thrown network/timeout error — propagates immediately', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

      const provider = new SliderDeliveryProvider();
      await expect(
        provider.createDelivery({
          orderId: 1,
          vehicleType: 'any',
          scheduleAt: null,
          pickup: {
            address: 'A',
            latitude: 1,
            longitude: 1,
            contactNumber: '1',
          },
          dropoff: {
            address: 'B',
            latitude: 2,
            longitude: 2,
            contactNumber: '2',
          },
          credentials,
        }),
      ).rejects.toThrow('timeout');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      [400, 'Slider rejected the request as malformed'],
      [401, 'Slider rejected the API key configured for this shop'],
      [402, 'insufficient balance'],
      [403, 'does not belong to this shop'],
      [404, 'not found'],
      [422, 'validation failed'],
    ])(
      'maps a %i response to an HttpException with the right status',
      async (status, messageFragment) => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(status, {}));

        const provider = new SliderDeliveryProvider();
        await expect(
          provider.createDelivery({
            orderId: 1,
            vehicleType: 'any',
            scheduleAt: null,
            pickup: {
              address: 'A',
              latitude: 1,
              longitude: 1,
              contactNumber: '1',
            },
            dropoff: {
              address: 'B',
              latitude: 2,
              longitude: 2,
              contactNumber: '2',
            },
            credentials,
          }),
        ).rejects.toThrow(new RegExp(messageFragment, 'i'));

        let caught: unknown;
        try {
          await provider.createDelivery({
            orderId: 1,
            vehicleType: 'any',
            scheduleAt: null,
            pickup: {
              address: 'A',
              latitude: 1,
              longitude: 1,
              contactNumber: '1',
            },
            dropoff: {
              address: 'B',
              latitude: 2,
              longitude: 2,
              contactNumber: '2',
            },
            credentials,
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(HttpException);
        expect((caught as HttpException).getStatus()).toBe(status);
      },
    );

    it('a 500 that never recovers (two failed attempts) still surfaces as a 500', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse(500, { message: 'down' }));

      const provider = new SliderDeliveryProvider();
      await expect(
        provider.createDelivery({
          orderId: 1,
          vehicleType: 'any',
          scheduleAt: null,
          pickup: {
            address: 'A',
            latitude: 1,
            longitude: 1,
            contactNumber: '1',
          },
          dropoff: {
            address: 'B',
            latitude: 2,
            longitude: 2,
            contactNumber: '2',
          },
          credentials,
        }),
      ).rejects.toThrow(/server error/i);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatus', () => {
    it('maps the status response, including a driver, to camelCase', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          order_number: 999,
          status: 'in_transit',
          tracking_url: 'https://track.slider-app.com/999',
          driver: {
            name: 'Ali',
            phone_number: '+971500000002',
            latitude: 25.15,
            longitude: 55.25,
            vehicle: 'bike',
          },
        }),
      );

      const provider = new SliderDeliveryProvider();
      const status = await provider.getStatus(999, credentials);

      expect(status).toEqual({
        orderNumber: 999,
        status: 'in_transit',
        trackingUrl: 'https://track.slider-app.com/999',
        driver: {
          name: 'Ali',
          phoneNumber: '+971500000002',
          latitude: 25.15,
          longitude: 55.25,
          vehicle: 'bike',
        },
      });
    });
  });

  describe('cancelDelivery', () => {
    it('sends a DELETE and resolves with no return value', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
      });

      const provider = new SliderDeliveryProvider();
      await expect(
        provider.cancelDelivery(999, credentials),
      ).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/deliveries/999'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('a 404 (already delivered/cancelled) surfaces as a 404 HttpException', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(404, {}));

      const provider = new SliderDeliveryProvider();
      let caught: unknown;
      try {
        await provider.cancelDelivery(999, credentials);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(404);
    });
  });
});
