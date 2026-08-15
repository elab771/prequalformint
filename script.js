document.addEventListener("DOMContentLoaded", () => {
  // Enforce bold typeface directly across all user-editable elements
  const formElements = document.querySelectorAll("input, select, textarea");
  formElements.forEach((el) => {
    el.style.fontWeight = "700";
  });
});

/**
 * Prepares the form before firing the PDF print dialog by flattening values
 * and restricting editable layers.
 */
function prepareAndPrint() {
  const form = document.getElementById("prequalForm");
  
  // Validate required fields before rendering PDF
  if (form && !form.checkValidity()) {
    form.reportValidity();
    return;
  }

  // Lock interactive inputs temporarily for a clean render snapshot
  const inputs = document.querySelectorAll("input, select, textarea");
  inputs.forEach((input) => {
    input.setAttribute("readonly", "true");
    if (input.tagName.toLowerCase() === "select") {
      input.style.pointerEvents = "none";
    }
  });

  // Launch the print / Save as PDF prompt
  window.print();

  // Restore fields after dialog closure
  inputs.forEach((input) => {
    input.removeAttribute("readonly");
    if (input.tagName.toLowerCase() === "select") {
      input.style.pointerEvents = "auto";
    }
  });
}

/**
 * Resets form fields
 */
function resetForm() {
  const form = document.getElementById("prequalForm");
  if (form && confirm("Clear all fields in this prequalification form?")) {
    form.reset();
  }
}
