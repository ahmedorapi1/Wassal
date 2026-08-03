# SKKA / سِكّة branding implementation

## Name

All user-facing product text uses `SKKA` in English and `سِكّة` in Arabic.
The Arabic slogan is `كل طلب له سكة`. Existing internal package names, database
names, queue names, token issuers, mobile bundle identifiers, and historical
specification filenames keep the `wasel`/`wassal` identifier for compatibility;
they are not rendered as product branding.

## Reference-derived tokens

The untouched source is `/reference.png`. Dominant opaque pixel analysis
identifies navy `#002f84` and orange `#fe6c10`.

| Token                 | Value     | Use                                    |
| --------------------- | --------- | -------------------------------------- |
| `brand-primary`       | `#002f84` | Dominant actions/navigation            |
| `brand-primary-hover` | `#00256a` | Primary hover                          |
| `brand-primary-dark`  | `#001c50` | Dark branded surfaces                  |
| `brand-accent`        | `#fe6c10` | Small non-text/location accents        |
| `brand-accent-hover`  | `#dc5400` | Accent interaction                     |
| `brand-accent-text`   | `#b54100` | Accessible orange-family text on white |
| `brand-surface`       | `#ffffff` | Main surface                           |
| `brand-background`    | `#f5f7fb` | Application canvas                     |
| `brand-text`          | `#101a2e` | Primary copy                           |
| `brand-text-muted`    | `#5d687b` | Secondary copy                         |
| `brand-border`        | `#d9dfeb` | Dividers/fields                        |
| `brand-success`       | `#147a55` | Success                                |
| `brand-warning`       | `#9b6500` | Warning                                |
| `brand-danger`        | `#b42318` | Destructive/error                      |

Contrast checks: primary/white 12.07:1, primary text/white 17.37:1, muted
text/white 5.63:1, accent-family text/white 5.64:1, and dark surface/white
16.38:1. Bright orange is intentionally used for graphics, dots, focus rings,
and backgrounds with dark text rather than small white-surface text.

## Assets

The supplied, untouched source is `/final logo.png`. Exact byte-for-byte copies
used by each runtime are:

- `/logo.png` for Next.js and React Native imports;
- `packages/ui/assets/brand/skka-logo.png`;
- `apps/admin-web/public/brand/skka-logo.png`;
- `apps/merchant-web/public/brand/skka-logo.png`;
- `apps/courier-mobile/assets/brand/skka-logo.png`.

The brand asset directory also contains legacy generated supporting assets:

- `primary-logo.png` and `primary-logo-transparent.png`;
- `primary-mark.png` and the cropped `primary-mark-source.png`;
- `primary-wordmark.png`;
- `favicon.ico`, `favicon.png`, and 16/32/48/180/192/512 icons;
- `expo-icon.png`, `adaptive-foreground.png`, and `splash.png`;
- helmet, motorcycle, and parcel supporting illustrations.

Next.js public copies are in `apps/admin-web/public/brand` and
`apps/merchant-web/public/brand`; Expo-consumable copies are in
`apps/courier-mobile/assets/brand`.

Admin, merchant, and courier rendered surfaces use the supplied SKKA logo.
Legacy illustrations are no longer referenced by the applications because
their artwork contains the retired wordmark.

## Expo and metadata

Expo display name is `SKKA Courier`; slug remains `wassal-courier`; iOS/Android
identifiers remain `com.wassal.courier` for installed-app compatibility. App
icon, adaptive foreground, and splash point to the exact supplied logo. Both
Next.js layouts declare SKKA titles/descriptions and use the exact supplied logo
for icon metadata.

## Source limitations

`final logo.png` is a 1536×1024 opaque raster image. It is used without cropping,
resizing, transparency conversion, recoloring, or regeneration.
