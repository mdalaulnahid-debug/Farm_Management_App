// Page header photos. Each has a 640 px copy that phones load instead (PageHeader › photoSmall), so a
// header costs about a third of the data on mobile. Lite mode shows none of them.
import dashRiverFull from './dash-river.webp';
import dashRiverSmall from './dash-river-640.webp';
import deltaAerialFull from './delta-aerial.webp';
import deltaAerialSmall from './delta-aerial-640.webp';
import duckPathFull from './duck-path.webp';
import duckPathSmall from './duck-path-640.webp';
import eggBasketFull from './egg-basket.webp';
import eggBasketSmall from './egg-basket-640.webp';
import feedStackFull from './feed-stack.webp';
import feedStackSmall from './feed-stack-640.webp';
import feedStoreFull from './feed-store.webp';
import feedStoreSmall from './feed-store-640.webp';
import ledgerDeskFull from './ledger-desk.webp';
import ledgerDeskSmall from './ledger-desk-640.webp';
import ledgerWindowFull from './ledger-window.webp';
import ledgerWindowSmall from './ledger-window-640.webp';
import salesMarketFull from './sales-market.webp';
import salesMarketSmall from './sales-market-640.webp';

export interface Photo { full: string; small: string }
export const dashRiver: Photo = { full: dashRiverFull, small: dashRiverSmall };
export const deltaAerial: Photo = { full: deltaAerialFull, small: deltaAerialSmall };
export const duckPath: Photo = { full: duckPathFull, small: duckPathSmall };
export const eggBasket: Photo = { full: eggBasketFull, small: eggBasketSmall };
export const feedStack: Photo = { full: feedStackFull, small: feedStackSmall };
export const feedStore: Photo = { full: feedStoreFull, small: feedStoreSmall };
export const ledgerDesk: Photo = { full: ledgerDeskFull, small: ledgerDeskSmall };
export const ledgerWindow: Photo = { full: ledgerWindowFull, small: ledgerWindowSmall };
export const salesMarket: Photo = { full: salesMarketFull, small: salesMarketSmall };
