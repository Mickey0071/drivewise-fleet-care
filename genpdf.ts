import { renderRentalAgreementPdf } from "@/components/pdf/RentalAgreementPDF";
import { DEFAULT_SETTINGS } from "@/lib/agreementSettings";
// monkeypatch console to capture
const data:any = {
  rental:{id:"1",startDate:"2026-05-01",endDate:"2026-06-01",billingCadence:"weekly",billingPeriod:"weekly",rateAmount:300,rate:300,weeklyRate:300,depositPaid:200,signedBy:"John Doe",signedAt:"2026-05-01",clientSignedAt:null,agreementVersion:"v1"},
  driver:{fullName:"John Doe",firstName:"John",lastName:"Doe",middleInitial:"A",dateOfBirth:"1990-01-01",licenseNumber:"D1234567",licenseExpiry:"2028-01-01",dlState:"NJ",phone:"609-555-1212",email:"j@e.com",streetAddress:"1 Main St",aptUnit:"2",city:"Camden",state:"NJ",zipCode:"08081",address:null,altContactName:"Jane",altContactPhone:"609-555-0000"},
  vehicle:{year:2022,make:"Ford",model:"Fusion",color:"Black",plate:"ABC123",vin:"1FADP",mileage:1000,fuelLevelPickup:"Full",ezPassTag:"TAG1"},
  extensions:[],settings:DEFAULT_SETTINGS,signaturePng:null,
};
await Bun.write("/tmp/agreement.pdf", await renderRentalAgreementPdf(data));
