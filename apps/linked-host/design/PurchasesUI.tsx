import UnavailablePreview from '../UnavailablePreview';
const unavailable = async () => { throw new Error('Store-hosted UI is unavailable in Canvas design preview.'); };
function CustomerCenterView() {
  return <UnavailablePreview title="Subscription service" reason="RevenueCat provides this screen. Its store connection is disabled in design preview." detail="Connect the app’s subscription service to view its customer center." />;
}
export default { CustomerCenterView, Paywall: CustomerCenterView, presentPaywall: unavailable, presentPaywallIfNeeded: unavailable, presentCustomerCenter: unavailable };
