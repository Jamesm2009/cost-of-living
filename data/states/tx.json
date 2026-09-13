{
  "code": "TX",
  "name": "Texas",
  "incomeTax": {
    "value": {
      "kind": "none"
    },
    "source": "https://comptroller.texas.gov/taxes/",
    "effectiveDate": "1900-01-01",
    "verifiedOn": "2026-09-12",
    "note": "No state or local income tax. Constitutionally constrained."
  },
  "propertyFramework": {
    "value": {
      "assessment": {
        "residentialAssessmentRatio": 1,
        "revaluationCycleYears": 1
      },
      "valueCap": {
        "label": "Tax Code §23.23 appraisal cap",
        "maxAnnualIncrease": 0.1,
        "requiresHomestead": true,
        "portable": false,
        "resetsOnTransfer": true
      },
      "statewideExemptions": [
        {
          "id": "tx-general-homestead-school",
          "label": "General residence homestead (school districts)",
          "amount": {
            "kind": "fixed",
            "amount": 140000
          },
          "appliesTo": [
            "school"
          ],
          "requiresHomestead": true,
          "eligibility": "general"
        },
        {
          "id": "tx-over65-school",
          "label": "Over-65 additional school exemption (+ levy freeze)",
          "amount": {
            "kind": "fixed",
            "amount": 60000
          },
          "appliesTo": [
            "school"
          ],
          "requiresHomestead": true,
          "eligibility": "age65Plus",
          "freezesLevyAmount": true
        }
      ]
    },
    "source": "https://ballotpedia.org/Texas_Proposition_13,_Increase_Homestead_Property_Tax_Exemption_Amendment_(2025)",
    "effectiveDate": "2026-01-01",
    "verifiedOn": "2026-09-12",
    "note": "$140k exemption via Prop 13 (SJR 2), approved Nov 4 2025. School levies only — city and county are unaffected."
  },
  "stateSalesTax": {
    "value": {
      "jurisdiction": "State of Texas",
      "rate": 0.0625,
      "exemptCategories": [
        "groceries",
        "prescriptionDrugs",
        "services"
      ]
    },
    "source": "https://comptroller.texas.gov/taxes/sales/",
    "effectiveDate": "2026-01-01",
    "verifiedOn": "2026-09-12",
    "note": "Local add-ons statutorily capped at 2.00%, so 8.25% is the ceiling anywhere in TX."
  },
  "vehicle": {
    "value": {
      "tax": {
        "kind": "none",
        "annualRegistration": 80
      },
      "purchaseSalesTaxRate": 0.0625,
      "oneTimeTitleAndFees": 60
    },
    "source": "https://www.txdmv.gov/",
    "effectiveDate": "2026-01-01",
    "verifiedOn": null,
    "note": "TODO: no annual value-based vehicle tax — structurally correct. Fee amounts unverified."
  }
}
