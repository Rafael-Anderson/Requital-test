// The platform's reporting base. Every `currencyrate` row is expressed as
// "units of quoteCurrency per 1 PLATFORM_BASE_CURRENCY", and every order stores
// the base it was captured against in `order.rateBaseCurrency` rather than
// assuming this constant — so changing it later is a data migration with a
// readable history instead of a silent reinterpretation of every stored rate.
//
// USD because six of the seven currencies this platform offers are pegged to it
// (see the 20260926220000_currency_rates migration), which makes USD the axis
// the rate set is actually shaped around. It is NOT the same thing as a shop's
// own currency, and nothing user-facing should display it.
export const PLATFORM_BASE_CURRENCY = 'USD';
