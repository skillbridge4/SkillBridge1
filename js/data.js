import internshipCatalog from '../data/seed/internships.json' with { type: 'json' };
import courseCatalog from '../data/seed/courses.json' with { type: 'json' };
export const INTERNSHIPS = internshipCatalog;
export const COURSES = courseCatalog;
export const ALL_SKILLS = [
  'JavaScript', 'React', 'Next.js', 'HTML5', 'CSS3', 'Node.js', 'Python', 'SQL',
  'Figma', 'UI Design', 'User Research', 'Wireframing', 'Prototyping',
  'Design Systems', 'Machine Learning', 'PyTorch', 'Data Analysis', 'Pandas',
  'Tableau', 'Docker', 'Kubernetes', 'Linux', 'AWS', 'Azure', 'Git', 'CI/CD',
  'Cybersecurity', 'Networking', 'Incident Response', 'Playwright', 'Testing',
  'Swift', 'SwiftUI', 'iOS Dev', 'Flutter', 'Dart', 'Mobile Dev', 'Solidity',
  'C/C++', 'Microcontrollers', 'Content Writing', 'SEO', 'Social Media',
  'Product Management', 'Roadmapping', 'Agile', 'Communication',
  'Public Speaking', 'Problem Solving'
];
export const DEFAULT_PROFILE = {
  name: '',
  headline: '',
  location: '',
  email: '',
  phone: '',
  bio: '',
  interests: [],
  skills: [],
  completedCourses: []
};
