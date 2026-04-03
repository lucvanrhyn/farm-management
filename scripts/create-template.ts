import * as XLSX from "xlsx";

const headers = [
  ["animal_id", "name", "sex", "date_of_birth", "breed", "category", "current_camp", "status", "mother_id", "father_id", "registration_number", "date_added"]
];

const ws = XLSX.utils.aoa_to_sheet(headers);
ws["!cols"] = [
  { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 10 },
  { wch: 10 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  { wch: 30 }, { wch: 12 },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Animals");
XLSX.writeFile(wb, "public/templates/animals-template.xlsx");
console.log("Template created: public/templates/animals-template.xlsx");
