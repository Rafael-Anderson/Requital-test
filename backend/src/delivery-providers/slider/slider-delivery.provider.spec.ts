import { HttpException } from '@nestjs/common';
import {
  SliderDeliveryProvider,
  buildCreateDeliveryBody,
  buildFareBody,
} from './slider-delivery.provider';
import type {
  CreateDeliveryParams,
  DeliveryProviderCredentials,
} from './slider-delivery.interface';

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
        orderId: '42',
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
        orderId: '1',
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
          orderId: '1',
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

    it.each<[number, string]>([
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
            orderId: '1',
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
            orderId: '1',
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
        // Regression: getResponse() must be a real { statusCode, message }
        // object, not a bare string — AllExceptionsFilter ships
        // getResponse() as-is, and a bare string loses its own .message
        // property once JSON-parsed by the admin's apiFetch(), which falls
        // back to the generic "Request failed (N)" instead of ever showing
        // this message. See ManageDeliveryModal's "Create Delivery" bug.
        const response = (caught as HttpException).getResponse();
        expect(typeof response).toBe('object');
        expect(response).toMatchObject({
          statusCode: status,
          message: expect.stringMatching(new RegExp(messageFragment, 'i')),
        });
      },
    );

    it("a real Slider 422 (e.g. a dropoff address outside the account's serviceable area) surfaces its own detail message, not just the generic category text", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse(422, {
          message:
            'dropoff address is outside the serviceable area for this account_id',
        }),
      );

      const provider = new SliderDeliveryProvider();
      let caught: unknown;
      try {
        await provider.createDelivery({
          orderId: '13',
          vehicleType: 'bike',
          scheduleAt: null,
          pickup: {
            address: 'Outlet',
            latitude: 25.2,
            longitude: 55.3,
            contactNumber: '1',
          },
          dropoff: {
            address: 'Al Taawun, Sharjah, Dubai',
            latitude: 25.35,
            longitude: 55.4,
            contactNumber: '2',
          },
          credentials,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(HttpException);
      const response = (caught as HttpException).getResponse() as {
        statusCode: number;
        message: string;
      };
      expect(response.statusCode).toBe(422);
      // Both the category text AND Slider's own real detail must be present
      // — this is the exact shape ManageDeliveryModal's dispatchError now
      // renders instead of "Request failed (422)".
      expect(response.message).toContain('validation failed');
      expect(response.message).toContain(
        'dropoff address is outside the serviceable area for this account_id',
      );
    });

    it('a 500 that never recovers (two failed attempts) still surfaces as a 500', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse(500, { message: 'down' }));

      const provider = new SliderDeliveryProvider();
      await expect(
        provider.createDelivery({
          orderId: '1',
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

  // Slider validates strictly (a numeric order_id was answered with 422
  // "The order id field must be a string"), so the JSON TYPE of every field
  // is part of the contract. This is a schema-like assertion over the exact
  // body the provider puts on the wire.
  describe('request payload shape', () => {
    const base: CreateDeliveryParams = {
      orderId: '42',
      displayOrderId: '#7',
      vehicleType: 'bike',
      scheduleAt: '2026-10-14T10:00:00.000Z',
      driverTip: 5,
      pickup: {
        address: 'Outlet A, Business Bay, Dubai',
        latitude: 25.2,
        longitude: 55.3,
        directions: 'Gate 2',
        contactNumber: '+971500000000',
      },
      dropoff: {
        address: 'Customer St',
        latitude: 25.1,
        longitude: 55.2,
        contactNumber: '+971500000001',
      },
      paymentOnDelivery: { type: 'cash', amount: 120.5 },
      credentials,
    };

    const typeOf = (v: unknown) => (v === null ? 'null' : typeof v);
    // Round-trip through JSON: what Slider actually receives.
    const wire = (body: object) =>
      JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

    it('sends every dispatch field with the exact JSON type', () => {
      const body = wire(buildCreateDeliveryBody(base));
      const point = (o: unknown) => {
        const p = o as Record<string, unknown>;
        return {
          address: typeOf(p.address),
          latitude: typeOf(p.latitude),
          longitude: typeOf(p.longitude),
          contact_number: typeOf(p.contact_number),
        };
      };
      expect({
        order_id: typeOf(body.order_id),
        account_id: typeOf(body.account_id),
        display_order_id: typeOf(body.display_order_id),
        vehicle_type: typeOf(body.vehicle_type),
        schedule_at: typeOf(body.schedule_at),
        driver_tip: typeOf(body.driver_tip),
        pickup: point(body.pickup),
        dropoff: point(body.dropoff),
        pod_type: typeOf(
          (body.payment_on_delivery as Record<string, unknown>).type,
        ),
        pod_amount: typeOf(
          (body.payment_on_delivery as Record<string, unknown>).amount,
        ),
      }).toEqual({
        order_id: 'string',
        account_id: 'string',
        display_order_id: 'string',
        vehicle_type: 'string',
        schedule_at: 'string',
        driver_tip: 'number',
        pickup: {
          address: 'string',
          latitude: 'number',
          longitude: 'number',
          contact_number: 'string',
        },
        dropoff: {
          address: 'string',
          latitude: 'number',
          longitude: 'number',
          contact_number: 'string',
        },
        pod_type: 'string',
        pod_amount: 'number',
      });
      expect(body.order_id).toBe('42');
      expect(body.display_order_id).toBe('#7');
      expect(Number.isNaN(Date.parse(body.schedule_at as string))).toBe(false);
    });

    it('omits optional fields instead of sending null', () => {
      const body = wire(
        buildCreateDeliveryBody({
          ...base,
          scheduleAt: null,
          driverTip: undefined,
          displayOrderId: undefined,
          paymentOnDelivery: undefined,
        }),
      );
      for (const key of [
        'schedule_at',
        'driver_tip',
        'display_order_id',
        'payment_on_delivery',
      ]) {
        expect(body).not.toHaveProperty(key);
      }
      expect(Object.values(body)).not.toContain(null);
      expect(body.pickup).not.toHaveProperty('directions', null);
    });

    it('the body handed to fetch carries order_id as a string', async () => {
      global.fetch = jest.fn().mockResolvedValue(
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
      await new SliderDeliveryProvider().createDelivery(base);
      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const sent = JSON.parse(init.body as string) as { order_id: unknown };
      expect(typeof sent.order_id).toBe('string');
    });

    it('sends the fare request with a string account_id and numeric coordinates', () => {
      const body = wire(
        buildFareBody({
          pickup: base.pickup,
          delivery: base.dropoff,
          credentials,
        }),
      );
      expect(typeOf(body.account_id)).toBe('string');
      for (const k of ['pickup', 'delivery']) {
        const p = body[k] as Record<string, unknown>;
        expect(typeOf(p.latitude)).toBe('number');
        expect(typeOf(p.longitude)).toBe('number');
      }
    });
  });
});
