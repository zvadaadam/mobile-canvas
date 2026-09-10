const unavailable = async () => { throw new Error('Purchases are disconnected in Canvas design preview.'); };
export const LOG_LEVEL = { DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };
export const PACKAGE_TYPE = { UNKNOWN: 'UNKNOWN', CUSTOM: 'CUSTOM', LIFETIME: 'LIFETIME', ANNUAL: 'ANNUAL', SIX_MONTH: 'SIX_MONTH', THREE_MONTH: 'THREE_MONTH', TWO_MONTH: 'TWO_MONTH', MONTHLY: 'MONTHLY', WEEKLY: 'WEEKLY' };
export const PURCHASES_ERROR_CODE = { NETWORK_ERROR: '10', PURCHASE_CANCELLED_ERROR: '1' };
const customerInfo = { entitlements: { active: {}, all: {} }, activeSubscriptions: [], allPurchasedProductIdentifiers: [], managementURL: null, originalAppUserId: 'canvas-preview' };
const Purchases = {
  ENTITLEMENT_VERIFICATION_MODE: { INFORMATIONAL: 'INFORMATIONAL' },
  configure: () => {}, setLogLevel: async () => {},
  getCustomerInfo: async () => customerInfo,
  getOfferings: async () => ({ current: null, all: {} }),
  getProducts: async () => [],
  addCustomerInfoUpdateListener: () => {}, removeCustomerInfoUpdateListener: () => {},
  invalidateCustomerInfoCache: async () => {}, isAnonymous: async () => true,
  logIn: unavailable, logOut: async () => customerInfo,
  purchasePackage: unavailable, purchaseProduct: unavailable, restorePurchases: unavailable,
};
export default Purchases;
