import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';
import { SubmitSurveyDto } from './dto/submit-survey.dto';

// Separate from PublicController (shop-slug-scoped), same reasoning as
// PublicOrderLookupController: a survey token is globally unique and
// self-sufficient — no shopSlug in the URL needed or wanted here.
@Controller('public/surveys')
export class PublicSurveyController {
  constructor(private readonly publicService: PublicService) {}

  @Public()
  @Get('lookup')
  lookup(@Query('token') token?: string) {
    return this.publicService.lookupSurvey(token);
  }

  @Public()
  @Post('submit')
  submit(
    @Query('token') token: string | undefined,
    @Body() dto: SubmitSurveyDto,
  ) {
    return this.publicService.submitSurvey(token, dto);
  }
}
