# Mapeamento Wake → Koin payload

Campos enviados na avaliação Koin mapeados a partir do payload Wake (`POST /payment`):

| Campo Koin           | Fonte Wake                               |
|----------------------|------------------------------------------|
| `reference_id`       | payment.id (nosso ULID interno)          |
| `order_id`           | `pedido` (número do pedido)              |
| `amount`             | `pagamento.valor` (em centavos)          |
| `fingerprint_id`     | `fraudId` coletado pelo script Koin      |
| `callback_url`       | `https://pay.letztech.com.br/webhooks/koin` |
| `customer.name`      | `usuario.nome`                           |
| `customer.document`  | `usuario.cpf` ou `usuario.cnpj`          |
| `customer.email`     | `usuario.email`                          |
| `customer.phone`     | `usuario.telefone`                       |
| `customer.ip`        | IP extraído do request (header)          |
| `customer.address`   | `usuario.endereco` (billing)             |
| `items[].sku`        | `produtos[n].sku`                        |
| `items[].name`       | `produtos[n].nome`                       |
| `items[].quantity`   | `produtos[n].quantidade`                 |
| `items[].unit_amount`| `produtos[n].precoUnitario`              |
| `shipping_amount`    | `pagamento.frete`                        |

## Fluxo por método de pagamento

- **Cartão de crédito:** Pre-evaluation (opcional) → autorização na Zoop → Evaluation → captura
- **Pix e boleto:** apenas Evaluation antes de criar a cobrança (Alternativo B da Koin)
