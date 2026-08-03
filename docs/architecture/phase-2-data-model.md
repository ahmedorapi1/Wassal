# Phase 2 database diagram

```mermaid
erDiagram
  Merchant {
    uuid id PK
  }
  Store {
    uuid id PK
    geography location
    StoreStatus status
  }
  Customer {
    uuid id PK
    uuid merchantId FK
    string normalizedPhone
    CustomerStatus status
    int version
  }
  Address {
    uuid id PK
    uuid merchantId FK
    uuid customerId FK
    decimal latitude
    decimal longitude
    geography location
    datetime archivedAt
    int version
  }
  ServiceZone {
    uuid id PK
    geography boundary
    ServiceZoneStatus status
    int version
  }
  PricingRule {
    uuid id PK
    string ruleFamilyKey
    int version
    PricingRuleStatus status
    json weightBands
  }
  PriceQuote {
    uuid id PK
    uuid merchantId FK
    uuid storeId FK
    uuid serviceZoneId FK
    uuid pricingRuleId FK
    string requestFingerprint
    string idempotencyKey
    QuoteStatus status
    datetime expiresAt
    json snapshots
  }
  DeliveryOrder {
    uuid id PK
    string orderNumber UK
    uuid quoteId UK
    OrderStatus status
    uuid courierId
    json snapshots
    int merchantTotalMinor
    int version
  }
  OrderEvent {
    uuid id PK
    uuid orderId FK
    OrderEventType eventType
    OrderStatus fromStatus
    OrderStatus toStatus
    datetime createdAt
  }
  IdempotencyRecord {
    uuid id PK
    string scope
    string key
    string requestHash
    IdempotencyStatus status
  }

  Merchant ||--o{ Store : owns
  Merchant ||--o{ Customer : owns
  Customer ||--o{ Address : saves
  Merchant ||--o{ PriceQuote : requests
  Store ||--o{ PriceQuote : pickup
  ServiceZone ||--o{ PriceQuote : validates
  PricingRule ||--o{ PriceQuote : prices
  PriceQuote ||--o| DeliveryOrder : creates
  DeliveryOrder ||--o{ OrderEvent : emits
```

`PriceQuote`, `DeliveryOrder` snapshots, `PricingRule` historical fields, and
`OrderEvent` rows are protected by database triggers. Address and zone geometry
have GiST indexes; customer, quote expiration/status, merchant/status/date,
order number, zone, pricing resolution, event, and cancellation reporting have
B-tree indexes.
