export const FIELDS = [
  'Software Engineering',
  'Data & AI',
  'Design',
  'Marketing',
  'Product',
  'Cloud & DevOps',
  'Cybersecurity',
  'Core Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Electrical Engineering',
  'Electronics & Embedded',
  'Business & Finance',
  'Research',
  'Education'
];

export const MODES = ['Remote', 'Hybrid', 'On-site'];
export const DURATIONS = [1, 2, 3, 4, 6, 12];
export const COMPANY_TYPES = ['MNC', 'Startup', 'PSU/Govt', 'Research', 'Program'];
export const PAID_STATUS = ['paid', 'unpaid', 'unknown'];
export const INTERNSHIP_SORTS = ['relevance', 'newest', 'deadline', 'stipend'];
export const COURSE_PRICING = ['free', 'paid'];
export const ELIGIBILITY = [
  'Any student',
  'Undergraduate',
  'Graduate',
  'Recent graduate',
  'School student'
];
export const COURSE_CATEGORIES = [
  'Frontend Development', 'UI/UX Design', 'Computer Science',
  'Data Science & AI', 'Backend Development', 'Software Engineering',
  'Cybersecurity', 'Cloud & DevOps', 'Product Management', 'Marketing',
  'Mobile Development', 'Career & Soft Skills'
];
export const COURSE_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const VIDEO_CATEGORIES = ['Internship Prep', 'Skills'];
export const VIDEO_TOPICS = [
  'Finding internships', 'Resume & CV', 'Cover letters & outreach',
  'LinkedIn & personal brand', 'GitHub & portfolio', 'Interview preparation',
  'Aptitude & reasoning', 'DSA & coding tests', 'Role-specific preparation',
  'Open source & hackathons', 'Workplace skills', 'Free certifications'
];
export const VIDEO_LANGUAGES = ['English', 'Hindi', 'Other'];
export const VIDEO_LEVELS = COURSE_LEVELS;
export const VIDEO_DURATION_FILTERS = ['all', 'under-10', '10-30', 'over-30', 'varies'];
export const LEARNING_PATH_IDS = [
  'web-development-basics',
  'python-foundations',
  'c-programming-basics',
  'data-and-ai-foundations',
  'resume-and-interview-preparation',
  'ui-ux-foundations',
  'cybersecurity-foundations'
];
export const DEFAULT_PATH_PASS_MARK = 70;

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh'
];

export const CITIES_BY_STATE = {
  'Andhra Pradesh': ['Amaravati', 'Gadanki', 'Sriharikota', 'Visakhapatnam', 'Vijayawada'],
  'Arunachal Pradesh': ['Itanagar'],
  Assam: ['Guwahati'],
  Bihar: ['Patna'],
  Chandigarh: ['Chandigarh'],
  Chhattisgarh: ['Raipur'],
  Delhi: ['New Delhi'],
  Goa: ['Panaji'],
  Gujarat: ['Ahmedabad', 'Gandhinagar', 'Surat', 'Vadodara'],
  Haryana: ['Gurugram', 'Faridabad'],
  'Himachal Pradesh': ['Shimla'],
  Jharkhand: ['Ranchi'],
  Karnataka: ['Bengaluru', 'Hassan', 'Mysuru', 'Mangalore'],
  Kerala: ['Kochi', 'Thiruvananthapuram'],
  'Madhya Pradesh': ['Bhopal', 'Indore'],
  Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Navi Mumbai'],
  Manipur: ['Imphal'],
  Meghalaya: ['Shillong'],
  Mizoram: ['Aizawl'],
  Nagaland: ['Kohima'],
  Odisha: ['Bhubaneswar'],
  Punjab: ['Chandigarh', 'Ludhiana', 'Amritsar'],
  Rajasthan: ['Jaipur', 'Udaipur'],
  Sikkim: ['Gangtok'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Mahendragiri'],
  Telangana: ['Hyderabad'],
  Tripura: ['Agartala'],
  'Uttar Pradesh': ['Noida', 'Lucknow', 'Kanpur'],
  Uttarakhand: ['Dehradun'],
  'West Bengal': ['Kolkata'],
  'Jammu and Kashmir': ['Srinagar', 'Jammu'],
  Ladakh: ['Leh'],
  Puducherry: ['Puducherry']
};

export const STIPEND_RANGES = [
  { id: 'under-10000', label: 'Under ₹10,000', min: 0, max: 9999 },
  { id: '10000-25000', label: '₹10,000–₹25,000', min: 10000, max: 25000 },
  { id: 'over-25000', label: 'Over ₹25,000', min: 25001, max: null }
];

export const SEARCH_ALIASES = {
  cv: ['resume'],
  resume: ['cv'],
  job: ['internship', 'career'],
  internships: ['internship', 'placement'],
  interview: ['hr', 'technical interview'],
  portfolio: ['github', 'projects', 'personal website'],
  'cold email': ['recruiter outreach', 'cover letter'],
  aptitude: ['reasoning', 'placement test'],
  dsa: ['data structures', 'algorithms', 'coding test'],
  gsoc: ['open source', 'summer of code'],
  certificate: ['certification', 'nptel', 'swayam'],
  ml: ['machine learning', 'data ai'],
  ai: ['artificial intelligence', 'machine learning'],
  blr: ['bengaluru', 'bangalore'],
  bangalore: ['bengaluru'],
  gurgaon: ['gurugram'],
  bombay: ['mumbai'],
  'web dev': ['web development', 'frontend', 'software engineering'],
  sde: ['software development engineer', 'software engineering'],
  embedded: ['embedded systems', 'electronics embedded', 'core engineering'],
  civil: ['civil engineering', 'core engineering'],
  core: ['core engineering', 'civil engineering', 'mechanical engineering', 'electrical engineering', 'electronics embedded'],
  research: ['research internship', 'summer research'],
  govt: ['government', 'psu/govt'],
  psu: ['psu/govt', 'government'],
  frontend: ['front end', 'web development'],
  devops: ['cloud devops', 'cloud & devops'],
  hyd: ['hyderabad'],
  pune: ['pune'],
  ncr: ['noida', 'gurugram', 'delhi']
};
