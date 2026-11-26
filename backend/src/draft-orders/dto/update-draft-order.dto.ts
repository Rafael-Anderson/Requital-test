import { DraftOrderFieldsDto } from './draft-order-fields.dto';

// Every field optional; `items`, if provided, replaces the full list.
export class UpdateDraftOrderDto extends DraftOrderFieldsDto {}
