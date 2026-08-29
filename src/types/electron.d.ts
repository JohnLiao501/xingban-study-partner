import type { StudyPartnerApi } from "../../shared/partner-pack";

declare global {
  interface Window {
    studyPartner?: StudyPartnerApi;
  }
}

export {};
