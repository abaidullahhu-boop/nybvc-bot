export interface JobApplicationContact {
  name?: string;
  phoneNumber?: string;
  nameSource?: 'owner' | 'applicant';
  ownerName?: string;
  applicantName?: string;
  applicantProfessionalTitle?: string;
  applicantLicense?: string;
  address?: string;
  borough?: string;
  jobDescription?: string;
}
