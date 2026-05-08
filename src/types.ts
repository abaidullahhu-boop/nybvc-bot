export interface BinRecord {
  bin: string;
  personId?: number;
  ownerEmail?: string;
  ownerPhone?: string;
  dealId?: number; // Added dealId for potential use
}

export interface Violation {
  violation_number?: string;
  violation_status?: string;
  [key: string]: any; // Allows any other properties
}

export interface Hearing {
  case_number?: string;
  status?: string;
  [key: string]: any;
}

// Interface for the owner lookup service
export interface ContactInfo {
  email: string;
  phone: string;
}

// New interface for DOB ECB Violations based on the provided JSON data.
export interface DobEcbViolation {
  isn_dob_bis_extract: string;
  ecb_violation_number: string;
  ecb_violation_status: string;
  dob_violation_number: string;
  bin: string;
  boro: string;
  block: string;
  lot: string;
  hearing_date: string;
  hearing_time: string;
  served_date: string;
  issue_date: string;
  severity: string;
  violation_type: string;
  respondent_name: string;
  respondent_house_number: string;
  respondent_street: string;
  respondent_city: string;
  respondent_zip: string;
  violation_description: string;
  penality_imposed: string;
  amount_paid: string;
  balance_due: string;
  infraction_code1: string;
  section_law_description1: string;
  aggravated_level: string;
  hearing_status: string;
  certification_status?: string; // Optional, as it's not present in all records.
}

// New interface for DOB Violations based on the provided JSON data.
export interface DobViolation {
  isn_dob_bis_viol: string;
  boro: string;
  bin: string;
  block: string;
  lot: string;
  issue_date: string;
  violation_type_code: string;
  violation_number: string;
  house_number: string;
  street: string;
  device_number: string;
  number: string;
  violation_category: string;
  violation_type: string;
  disposition_date?: string;
  disposition_comments?: string;
  description?: string;
}

// New interface for DOB Complaints Received based on the provided JSON data.
export interface DobComplaintReceived {
  complaint_number: string;
  status: string;
  date_entered: string;
  house_number: string;
  house_street: string;
  zip_code: string;
  bin: string;
  community_board: string;
  complaint_category: string;
  unit: string;
  disposition_date: string;
  disposition_code: string;
  inspection_date: string;
  dobrundate: string;
}

// New interface for DOB Safety Violations based on provided JSON data.
export interface DobSafetyViolation {
  bin: string;
  violation_issue_date: string;
  violation_number: string;
  violation_type: string;
  violation_remarks: string;
  violation_status: string;
  device_number: string;
  device_type: string;
  cycle_end_date: string;
  borough: string;
  block: string;
  lot: string;
  house_number: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  latitude: string;
  longitude: string;
  community_board: string;
  council_district: string;
  bbl: string;
  census_tract_2020_: string;
  neighborhood_tabulation_area_nta_2020_: string;
}

// New interface for Housing Maintenance Code Violations based on provided JSON data.
export interface HousingMaintenanceCodeViolation {
  violationid: string;
  buildingid: string;
  registrationid: string;
  boroid: string;
  boro: string;
  housenumber: string;
  lowhousenumber: string;
  highhousenumber: string;
  streetname: string;
  streetcode: string;
  zip: string;
  apartment?: string; // Optional since not all records include it.
  story: string;
  block: string;
  lot: string;
  class: string; // Use quotes as "class" is a reserved word.
  inspectiondate: string;
  approveddate: string;
  originalcertifybydate: string;
  originalcorrectbydate: string;
  certifieddate: string;
  ordernumber: string;
  novid: string;
  novdescription: string;
  novissueddate: string;
  currentstatusid: string;
  currentstatus: string;
  currentstatusdate: string;
  novtype: string;
  violationstatus: string;
  rentimpairing: string;
  latitude: string;
  longitude: string;
  communityboard: string;
  councildistrict: string;
  censustract: string;
  bin: string;
  bbl: string;
  nta: string;
}

// New interface for Housing Litigations based on provided JSON data.
export interface HousingLitigation {
  litigationid: string;
  buildingid: string;
  boroid: string;
  housenumber: string;
  streetname: string;
  zip: string;
  block: string;
  lot: string;
  casetype: string;
  caseopendate: string;
  casestatus: string;
  casejudgement: string;
  findingofharassment?: string; // Optional as it's not included in every record.
  respondent: string;
  latitude: string;
  longitude: string;
  community_district: string;
  council_district: string;
  census_tract: string;
  bin: string;
  bbl: string;
  nta: string;
}

// New interface for Order to Repair/Vacate Orders based on provided JSON data.
export interface OrderToRepairVacateOrder {
  building_id: string;
  registration_id: string;
  boro_short_name: string;
  house_number: string;
  street_name: string;
  vacate_order_number: string;
  primary_vacate_reason: string;
  vacate_type: string;
  vacate_effective_date: string;
  actual_rescind_date?: string;
  number_of_vacated_units: string;
  postoce: string;
  latitude: string;
  longitude: string;
  community_board: string;
  council_district: string;
  census_tract: string;
  bin: string;
  bbl: string;
  nta: string;
}

// New interface for Housing Maintenance Code Complaints And Problems based on provided JSON data.
export interface HousingMaintenanceCodeComplaintAndProblem {
  received_date: string;
  problem_id: string;
  complaint_id: string;
  building_id: string;
  borough: string;
  house_number: string;
  street_name: string;
  post_code: string;
  block: string;
  lot: string;
  apartment: string;
  community_board: string;
  unit_type: string;
  space_type: string;
  type: string;
  major_category: string;
  minor_category: string;
  problem_code: string;
  complaint_status: string;
  complaint_status_date: string;
  problem_status: string;
  problem_status_date: string;
  status_description: string;
  problem_duplicate_flag: string;
  complaint_anonymous_flag: string;
  unique_key: string;
  latitude: string;
  longitude: string;
  council_district: string;
  census_tract: string;
  bin: string;
  bbl: string;
  nta: string;
}

// New interface for Rodent Inspection Violations based on provided JSON data.
export interface RodentInspectionViolation {
  inspection_type: string;
  job_ticket_or_work_order_id: string;
  job_id: string;
  job_progress: string;
  bbl: string;
  boro_code: string;
  block: string;
  lot: string;
  house_number: string;
  street_name: string;
  zip_code: string;
  x_coord: string;
  y_coord: string;
  latitude: string;
  longitude: string;
  borough: string;
  inspection_date: string;
  result: string;
  approved_date: string;
  location: {
    latitude: string;
    longitude: string;
    human_address: string;
  };
  community_board: string;
  council_district: string;
  census_tract: string;
  bin: string;
  nta: string;
}
