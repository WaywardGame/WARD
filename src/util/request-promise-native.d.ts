
import * as request from "request";

declare module "request-promise-native" {
	// tslint:disable-next-line interface-name
	interface RequestPromise {
		response: request.RequestResponse;
	}
}
