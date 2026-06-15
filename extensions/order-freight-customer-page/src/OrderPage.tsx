import { reactExtension } from "@shopify/ui-extensions-react/customer-account";
import { OrderFreight } from "./OrderFreight";

const TARGET = "customer-account.order.page.render";

export default reactExtension(TARGET, () => <OrderFreight />);
