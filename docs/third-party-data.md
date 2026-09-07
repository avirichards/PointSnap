# Reference data

Display currency conversion uses the [Frankfurter API](https://frankfurter.dev), a free reference-rate service. Server requests fetch rates in a common USD base; the visitor's IP is never sent to this service. Rates are cached for one hour, carry their reference date and are not used for conversion after seven days. These are estimates, not the exchange rate charged by a card or airline.

The country-to-currency table in `src/lib/country-currencies.json` is generated from Unicode CLDR's [supplemental currency data](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-core/supplemental/currencyData.json), selecting legal-tender entries effective September5,2026. Unicode data is used under the [Unicode License](https://www.unicode.org/license.txt). Country detection uses the hosting platform's IP-country header in Vercel, otherwise an explicit browser locale region; users can override and remember the display currency. Unknown countries fall back to USD.
