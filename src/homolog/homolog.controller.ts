import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { HomologService, TEST_CARDS } from './homolog.service';
import { AdminGuard } from '../admin/admin.guard';

const CHECKLIST = [
  { row: 'Configuração do Conector no Admin', scenario: null, note: 'Fora do escopo deste harness — validar CRUD via POST/PATCH /v1/stores e na tela de configuração do conector no admin da Wake.' },
  { row: 'Teste de Pedido Simples PF', scenario: 'cartao_pf_completo' },
  { row: 'Teste de Pedido Simples PJ', scenario: 'cartao_pj_completo' },
  { row: 'Teste de Pedido com Cartão Tokenizado', scenario: 'cartao_tokenizado' },
  { row: 'Teste de Pedido com Split de Pedido (Múltiplos CDs)', scenario: null, note: 'Split de CD é orquestrado pela Wake chamando /wake/payment uma vez por CD — nada específico a simular aqui.' },
  { row: 'Teste de Pedido com Split de Pagamento (Múltiplos Recebedores)', scenario: null, note: 'Requer duas lojas reais (dois recebedores) configuradas na Wake — não é demonstrável com uma única loja fake.' },
  { row: 'Teste de Pedido de Assinatura/Recorrência', scenario: null, note: 'Conector não implementa recorrência própria; cada ciclo chegaria como um novo POST /wake/payment, igual a um pedido comum.' },
  { row: 'Teste de retorno TID/NSU/Auth', scenario: 'cartao_pf_completo', note: '"transacao" retornado é usado como TID/NSU/Auth.' },
  { row: 'Teste de troca de pagamento', scenario: 'troca_pagamento' },
  { row: 'Teste de retorno das informações de boleto e pix no ADM do pedido', scenario: 'pix_pedido / boleto_pedido' },
  { row: 'Teste de retorno do erro para pedidos cancelados', scenario: 'cartao_recusado' },
  { row: 'Teste de retorno das informações de boleto e pix no minha conta', scenario: 'pix_pedido / boleto_pedido' },
  { row: 'Teste de tokenização do cartão', scenario: 'cartao_tokenizado' },
  { row: 'Teste com cartão sugerido', scenario: 'cartao_tokenizado', note: 'Reuso do token tokenizado representa o "cartão sugerido".' },
  { row: 'Teste de Pedido com Juros', scenario: 'cartao_com_juros' },
  { row: 'Teste de Pedido com Desconto', scenario: 'cartao_com_juros', note: 'Desconto/juros são aplicados pela Wake sobre "valor" antes de chamar o conector — mesmo mecanismo de passthrough.' },
  { row: 'Teste de Pedido com Promoção', scenario: 'cartao_com_juros', note: 'Mesmo mecanismo de passthrough de "valor".' },
  { row: 'Teste de Estorno de Pagamento', scenario: 'estorno_total / estorno_parcial' },
  { row: 'Antifraude Manual - Autorização Sucesso', scenario: 'cartao_pf_completo' },
  { row: 'Antifraude Manual - Autorização Falha/Negada', scenario: 'cartao_recusado' },
  { row: 'Antifraude Manual - Captura Sucesso', scenario: 'cartao_pf_completo' },
  { row: 'Antifraude Manual - Captura Falha', scenario: 'cancelamento_pos_autorizacao' },
  { row: 'Antifraude Clearsale - Autorização Sucesso', scenario: null, note: 'Clearsale não é um provedor integrado (apenas Koin) — N/A.' },
  { row: 'Antifraude Clearsale - Autorização Falha/Negada', scenario: null, note: 'N/A — mesmo motivo acima.' },
  { row: 'Antifraude Clearsale - Captura Sucesso', scenario: null, note: 'N/A — mesmo motivo acima.' },
  { row: 'Antifraude Clearsale - Captura Falha', scenario: null, note: 'N/A — mesmo motivo acima.' },
];

/**
 * Test harness for the Wake Commerce connector homologation checklist.
 * Drives the real /wake/* routes end-to-end against a dedicated store whose
 * Zoop leg is faked (FakeZoopProvider) — LetzTech has no Zoop staging/homolog
 * credentials to exercise real charges against.
 */
@Controller('homolog')
@UseGuards(AdminGuard)
export class HomologController {
  constructor(private readonly homologService: HomologService) {}

  @Post('store')
  bootstrapStore() {
    return this.homologService.bootstrapStore();
  }

  @Post('store/rotate-key')
  rotateKey() {
    return this.homologService.rotateKey();
  }

  @Get('test-cards')
  testCards() {
    return TEST_CARDS;
  }

  @Get('checklist')
  checklist() {
    return CHECKLIST;
  }

  @Post('run')
  async run(@Body() body: { wakeStoreHeader?: string; apiKey?: string }) {
    if (!body?.wakeStoreHeader || !body?.apiKey) {
      throw new BadRequestException({
        error: {
          code: 'missing_credentials',
          message: 'wakeStoreHeader and apiKey are required — get them from POST /homolog/store (or /homolog/store/rotate-key).',
        },
      });
    }
    return this.homologService.runScenarios(body.wakeStoreHeader, body.apiKey);
  }
}
