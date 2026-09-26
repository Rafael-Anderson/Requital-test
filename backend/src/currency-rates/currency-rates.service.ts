import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { createLogger } from '../common/logging/logger';
import { PLATFORM_BASE_CURRENCY } from './currency-rates.constants';

const logger = createLogger('CurrencyRates');

export interface CapturedRate {
  rateBaseCurrency: string;
  exchangeRate: string;
}

export interface CurrencyRateRow {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  updatedAt: Date;
  updatedByPlatformAdminId: number | null;
}

@Injectable()
export class CurrencyRatesService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<CurrencyRateRow[]> {
    return this.db.query<(CurrencyRateRow & RowDataPacket)[]>(
      `SELECT baseCurrency, quoteCurrency, rate, updatedAt, updatedByPlatformAdminId
         FROM currencyrate
        WHERE baseCurrency = ?
        ORDER BY quoteCurrency`,
      [PLATFORM_BASE_CURRENCY],
    );
  }

  // Upsert rather than insert-or-404: a platform admin setting a rate for a
  // currency that has no row yet is a legitimate first write (a new currency
  // being brought online), not an error.
  async setRate(
    quoteCurrency: string,
    rate: number,
    platformAdminId: number,
  ): Promise<CurrencyRateRow> {
    const quote = quoteCurrency.trim().toUpperCase();
    await this.db.execute(
      `INSERT INTO currencyrate
         (baseCurrency, quoteCurrency, rate, updatedAt, updatedByPlatformAdminId)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         rate = VALUES(rate),
         updatedAt = VALUES(updatedAt),
         updatedByPlatformAdminId = VALUES(updatedByPlatformAdminId)`,
      [PLATFORM_BASE_CURRENCY, quote, rate, new Date(), platformAdminId],
    );
    const rows = await this.db.query<(CurrencyRateRow & RowDataPacket)[]>(
      `SELECT baseCurrency, quoteCurrency, rate, updatedAt, updatedByPlatformAdminId
         FROM currencyrate WHERE baseCurrency = ? AND quoteCurrency = ?`,
      [PLATFORM_BASE_CURRENCY, quote],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`No rate stored for ${quote}`);
    }
    return rows[0];
  }

  // Resolves the rate to FREEZE onto a row being created right now.
  //
  // Returns null rather than throwing, and never substitutes a fallback, when no
  // rate is stored for the currency. That is deliberate and is the whole reason
  // `order.exchangeRate` is nullable: a missing rate means "we do not know what
  // this was worth", and recording that honestly is strictly better than either
  // failing a real customer's checkout over a reporting figure, or writing a 1
  // that later reads as "this order was at parity with the base".
  //
  // Takes an optional connection so a caller already inside a transaction reads
  // the same snapshot it is about to write against, rather than a rate that
  // could have been changed by a platform admin in between.
  async resolveForCapture(
    currency: string,
    conn?: PoolConnection,
  ): Promise<CapturedRate | null> {
    const quote = currency.trim().toUpperCase();
    const sql = `SELECT rate FROM currencyrate WHERE baseCurrency = ? AND quoteCurrency = ?`;
    const params = [PLATFORM_BASE_CURRENCY, quote];
    const rows = conn
      ? ((await conn.query<RowDataPacket[]>(sql, params))[0] as RowDataPacket[])
      : await this.db.query<RowDataPacket[]>(sql, params);

    if (rows.length === 0) {
      // Worth a log line: it means a shop is trading in a currency the platform
      // has no rate for, which is a configuration gap someone should close.
      logger.warn('no exchange rate stored for currency — capturing null', {
        currency: quote,
        baseCurrency: PLATFORM_BASE_CURRENCY,
      });
      return null;
    }
    return {
      rateBaseCurrency: PLATFORM_BASE_CURRENCY,
      exchangeRate: String(rows[0].rate),
    };
  }
}
