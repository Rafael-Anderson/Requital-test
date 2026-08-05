import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { NotifySubscriptionsService } from './notify-subscriptions.service';
import { SubscribeDto } from './dto/subscribe.dto';

@Public()
@Controller('notify-subscriptions')
export class NotifySubscriptionsController {
  constructor(
    private readonly notifySubscriptionsService: NotifySubscriptionsService,
  ) {}

  @Post()
  subscribe(@Body() dto: SubscribeDto) {
    return this.notifySubscriptionsService.subscribe(dto);
  }

  @Delete()
  unsubscribe(
    @Query('email') email?: string,
    @Query('productId') productId?: string,
  ) {
    if (!email || !productId || !/^\d+$/.test(productId)) {
      throw new BadRequestException(
        'email and a numeric productId are required',
      );
    }
    return this.notifySubscriptionsService.unsubscribe(
      email,
      Number(productId),
    );
  }
}
