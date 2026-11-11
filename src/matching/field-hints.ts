/**
 * Deterministic profile-key hints from field markup. Standard contact fields carry
 * reliable machine names (autocomplete tokens, ATS input names such as Greenhouse
 * `first_name`, Lever `org` or `urls[LinkedIn]`, Workday `legalNameSection_firstName`),
 * which are more trustworthy than fuzzy label matching.
 */

const autocompleteKeys: Record<string, string> = {
  name: 'fullName',
  'given-name': 'firstName',
  'additional-name': 'middleName',
  'family-name': 'lastName',
  nickname: 'preferredName',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'street-address': 'address',
  'address-line1': 'address',
  'address-line2': 'addressLine2',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'zip',
  country: 'country',
  'country-name': 'country',
  organization: 'currentCompany',
  'organization-title': 'currentTitle',
};

// Fields about someone other than the applicant, or about a school/past job,
// often reuse the same suffixes ("referenceFirstName", "schoolCity").
const excludedContext = /emergency|reference|referr|spouse|guardian|parent|school|education|institution|previous|former|manager|supervisor|ethnic/;

// Order matters: "fullname" must be checked before the shorter "lastname"-style suffixes.
const suffixRules: Array<[string, string[]]> = [
  ['fullName', ['fullname', 'candidatename', 'applicantname', 'yourname']],
  ['firstName', ['firstname', 'givenname']],
  ['middleName', ['middlename']],
  ['lastName', ['lastname', 'familyname', 'surname']],
  ['preferredName', ['preferredname', 'nickname']],
  ['email', ['email', 'emailaddress']],
  ['phone', ['phone', 'phonenumber', 'mobile', 'mobilephone', 'mobilenumber', 'telephone', 'cellphone']],
  ['addressLine2', ['addressline2', 'address2']],
  ['address', ['addressline1', 'address1', 'streetaddress']],
  ['city', ['city']],
  ['state', ['state', 'province', 'stateprovince']],
  ['zip', ['zip', 'zipcode', 'postalcode', 'postcode']],
  ['currentCompany', ['currentcompany', 'currentemployer']],
  ['currentTitle', ['currenttitle', 'currentjobtitle']],
];

const containsRules: Array<[string, string]> = [
  ['linkedin', 'linkedin'],
  ['github', 'github'],
  ['portfolio', 'portfolio'],
];

const exactRules: Record<string, string> = {
  name: 'fullName',
  fname: 'firstName',
  lname: 'lastName',
  org: 'currentCompany',
  website: 'website',
  personalwebsite: 'website',
};

export type FieldHintInput = { autocomplete?: string; inputType?: string; attributeHints?: string[] };

/** Profile key suggested by an attribute value such as `job_application[first_name]`, or undefined. */
export function profileKeyFromAttribute(value: string): string | undefined {
  const compact = value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
  if (!compact || excludedContext.test(compact)) return undefined;
  if (exactRules[compact]) return exactRules[compact];
  for (const [key, needle] of containsRules) if (compact.includes(needle)) return key;
  for (const [key, suffixes] of suffixRules) {
    if (suffixes.some((suffix) => compact.endsWith(suffix))) return key;
  }
  return undefined;
}

/** Best deterministic profile key for a field, without the `profile.` prefix. */
export function profileKeyHint(field: FieldHintInput): string | undefined {
  const autocompleteToken = field.autocomplete?.trim().toLocaleLowerCase('en-US').split(/\s+/).at(-1);
  if (autocompleteToken && autocompleteKeys[autocompleteToken]) return autocompleteKeys[autocompleteToken];
  for (const attribute of field.attributeHints ?? []) {
    const key = profileKeyFromAttribute(attribute);
    if (key) return key;
  }
  if (field.inputType === 'email') return 'email';
  if (field.inputType === 'tel') return 'phone';
  return undefined;
}
