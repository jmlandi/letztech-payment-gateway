import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { StoresService } from '../stores/stores.service';
import { StoreSettings } from '../stores/entities/store-settings.entity';
import { AdminGuard } from './admin.guard';
import { maskCustomer } from '../common/utils/mask-pii';

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
  capturePayment(@Param('id') id: string, @Query('store_id') storeId: string, @Body() body: { amount?: number }) {
    // TODO: delegate to payments service → Zoop capture
    return { id, storeId, amount: body.amount };
  }

  @Post('payments/:id/cancel')
  cancelPayment(@Param('id') id: string, @Query('store_id') storeId: string) {
    // TODO: delegate to payments service → Zoop void/refund
    return { id, storeId };
  }

  // --- Risk review ---

  @Get('risk/evaluations')
  async listRiskEvaluations(
    @Query('store_id') storeId?: string,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('min_score') minScore?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { data, total } = await this.paymentsService.findFraudEvaluations({
      storeId,
      status,
      provider,
      minScore: minScore !== undefined ? parseInt(minScore, 10) : undefined,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return {
      total,
      data: data.map((fe) => ({
        id: fe.id,
        paymentId: fe.paymentId,
        storeId: fe.storeId,
        provider: fe.provider,
        referenceId: fe.referenceId,
        evaluationId: fe.evaluationId,
        type: fe.type,
        status: fe.status,
        score: fe.score,
        createdAt: fe.createdAt,
        payment: {
          externalRef: fe.payment.externalRef,
          status: fe.payment.status,
          method: fe.payment.method,
          amount: fe.payment.amount,
          currency: fe.payment.currency,
          createdAt: fe.payment.createdAt,
        },
        // PII is always masked — raw customer data never leaves the DB here.
        customer: maskCustomer(fe.payment.customer),
      })),
    };
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
