import { Body, Controller, Get, NotImplementedException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { StoresService } from '../stores/stores.service';
import { StoreSettings } from '../stores/entities/store-settings.entity';
import { AdminGuard } from './admin.guard';

@Controller('v1')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly storesService: StoresService,
  ) {}

  // --- Payments ---

  @Get('payments/:id')
  getPayment(@Param('id') id: string, @Query('store_id') storeId: string) {
    return this.paymentsService.findById(id, storeId);
  }

  @Get('payments')
  listPayments(
    @Query('store_id') storeId: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentsService.findAll(storeId, {
      status,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('payments/:id/capture')
  capturePayment(): never {
    // Not wired to the payments service → Zoop capture yet. Was a stub
    // returning a fake success body since the first MVP commit; failing
    // loudly is safer than a capture call that silently does nothing.
    throw new NotImplementedException('Payment capture is not implemented yet');
  }

  @Post('payments/:id/cancel')
  cancelPayment(): never {
    // Not wired to the payments service → Zoop void/refund yet. Same
    // reasoning as capturePayment above.
    throw new NotImplementedException('Payment cancellation is not implemented yet');
  }

  // --- Stores ---

  @Post('stores')
  createStore(@Body() body: { name: string; slug: string; zoopSellerId?: string }) {
    return this.storesService.createStore(body.name, body.slug, body.zoopSellerId);
  }

  @Patch('stores/:id/slug')
  updateSlug(@Param('id') id: string, @Body() body: { slug: string }) {
    return this.storesService.updateSlug(id, body.slug);
  }

  @Patch('stores/:id/settings')
  updateSettings(
    @Param('id') id: string,
    @Body() body: Partial<Pick<StoreSettings, 'fraudEnabled' | 'koinPrivateKeyEncrypted' | 'zoopSellerId' | 'enabledMethods'>>,
  ) {
    return this.storesService.updateSettings(id, body);
  }

  @Get('stores/:id/receivables')
  getReceivables(@Param('id') id: string) {
    // Proxy to Zoop receivables API
    return { storeId: id, receivables: [] };
  }
}
