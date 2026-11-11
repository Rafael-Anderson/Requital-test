import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCollectionDto } from './create-collection.dto';
import { UpdateCollectionDto } from './update-collection.dto';
import { COLLECTION_SORT_KEYS } from '../collection-sort';

async function errorsFor<T extends object>(cls: new () => T, body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('collection defaultSort validation', () => {
  it('accepts every key the storefront collection page offers, on create and update', async () => {
    for (const key of COLLECTION_SORT_KEYS) {
      expect(await errorsFor(CreateCollectionDto, { name: 'A', defaultSort: key })).toEqual([]);
      expect(await errorsFor(UpdateCollectionDto, { defaultSort: key })).toEqual([]);
    }
  });

  it('the allowed keys are exactly the storefront SORT_OPTIONS', () => {
    expect([...COLLECTION_SORT_KEYS].sort()).toEqual(
      ['az', 'best_selling', 'newest', 'oldest', 'price_asc', 'price_desc', 'za'],
    );
  });

  it('rejects an unknown value, including SQL-looking and look-alike keys', async () => {
    for (const bad of ['popular', 'NEWEST', 'price', "newest'; DROP TABLE collection; --", '', ' newest', 1]) {
      expect((await errorsFor(CreateCollectionDto, { name: 'A', defaultSort: bad })).length).toBeGreaterThan(0);
      expect((await errorsFor(UpdateCollectionDto, { defaultSort: bad })).length).toBeGreaterThan(0);
    }
  });

  it('null clears it on update (back to the Newest behaviour) and absent leaves it alone', async () => {
    expect(await errorsFor(UpdateCollectionDto, { defaultSort: null })).toEqual([]);
    expect(await errorsFor(UpdateCollectionDto, {})).toEqual([]);
  });
});
