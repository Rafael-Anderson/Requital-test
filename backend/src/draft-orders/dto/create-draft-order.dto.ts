import { DraftOrderFieldsDto } from './draft-order-fields.dto';

// outletId, customerName and customerPhone are required; checked in
// DraftOrdersService.create (the shared field class keeps every field
// optional so Update and Preview can reuse it).
export class CreateDraftOrderDto extends DraftOrderFieldsDto {}
