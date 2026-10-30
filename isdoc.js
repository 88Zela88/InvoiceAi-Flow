import { showToast } from './ui.js';

function escapeXml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe).replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;'; case '>': return '&gt;'; case '&': return '&amp;';
            case "'": return '&apos;'; case '"': return '&quot;';
        }
    });
}

function generateValidUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function generateISDOCXml(inv) {
    const docId = inv.invoiceNumber || inv.vs || inv.id || 'INV-001';
    const issueDate = inv.dateIssue || new Date().toISOString().split('T')[0];
    const taxDate = inv.dateTax || issueDate;
    const dueDate = inv.dateDue || issueDate;
    const amount = Number(inv.amount || 0).toFixed(2);
    const baseAmount = Number(inv.baseAmount || 0).toFixed(2);
    const vatAmount = Number(inv.vatAmount || 0).toFixed(2);
    const vatRate = Number(inv.vatRate || 21).toFixed(2);
    const vendorName = inv.vendor || 'Dodavatel';
    const clientName = inv.clientName || 'Klient';
    const ico = inv.ico || '00000000';
    const vs = inv.vs || docId.replace(/\D/g, '') || '0';
    const bankAccount = inv.accountNumber || '';
    const paymentMethod = inv.paymentMethod || 'Převodem';
    
    // Vygenerujeme validní ISDOC UUID
    const validUuid = generateValidUUID();

    let paymentCode = paymentMethod === 'Hotově' ? '10' : paymentMethod === 'Kartou' ? '48' : paymentMethod === 'Zápočtem' ? '97' : '31';

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.1">
  <DocumentType>1</DocumentType>
  <ID>${escapeXml(docId)}</ID>
  <UUID>${validUuid}</UUID>
  <IssuingSystem>ČtiDoklad</IssuingSystem>
  <IssueDate>${escapeXml(issueDate)}</IssueDate>
  <TaxPointDate>${escapeXml(taxDate)}</TaxPointDate>
  <VATApplicable>true</VATApplicable>
  <Note>${escapeXml(inv.note || '')}</Note>
  <LocalCurrencyCode>CZK</LocalCurrencyCode>
  <CurrRate>1</CurrRate>
  <RefCurrRate>1</RefCurrRate>
  <AccountingSupplierParty><Party><PartyIdentification><ID>${escapeXml(ico)}</ID></PartyIdentification><PartyName><Name>${escapeXml(vendorName)}</Name></PartyName></Party></AccountingSupplierParty>
  <AccountingCustomerParty><Party><PartyName><Name>${escapeXml(clientName)}</Name></PartyName></Party></AccountingCustomerParty>
  <PaymentMeans><Payment><PaidAmount>${amount}</PaidAmount><PaymentMeansCode>${paymentCode}</PaymentMeansCode><Details><PaymentDueDate>${escapeXml(dueDate)}</PaymentDueDate><ID>${escapeXml(bankAccount)}</ID><VariableSymbol>${escapeXml(vs)}</VariableSymbol></Details></Payment></PaymentMeans>
  <TaxTotal><TaxSubTotal><TaxableAmount>${baseAmount}</TaxableAmount><TaxAmount>${vatAmount}</TaxAmount><TaxCategory><Percent>${vatRate}</Percent><VATCalculationMethod>0</VATCalculationMethod></TaxCategory></TaxSubTotal><TaxAmount>${vatAmount}</TaxAmount></TaxTotal>
  <LegalMonetaryTotal><TaxExclusiveAmount>${baseAmount}</TaxExclusiveAmount><TaxInclusiveAmount>${amount}</TaxInclusiveAmount><AlreadyClaimedDateTaxExclusiveAmount>0.00</AlreadyClaimedDateTaxExclusiveAmount><AlreadyClaimedTaxInclusiveAmount>0.00</AlreadyClaimedTaxInclusiveAmount><DifferenceTaxExclusiveAmount>${baseAmount}</DifferenceTaxExclusiveAmount><DifferenceTaxInclusiveAmount>${amount}</DifferenceTaxInclusiveAmount><PayableRoundingAmount>0.00</PayableRoundingAmount><PaidDepositsAmount>0.00</PaidDepositsAmount><PayableAmount>${amount}</PayableAmount></LegalMonetaryTotal>
  <InvoiceLines><InvoiceLine><ID>1</ID><InvoicedQuantity unitCode="C62">1</InvoicedQuantity><LineExtensionAmount>${baseAmount}</LineExtensionAmount><LineExtensionAmountTaxInclusive>${amount}</LineExtensionAmountTaxInclusive><LineExtensionTaxAmount>${vatAmount}</LineExtensionTaxAmount><UnitPrice>${baseAmount}</UnitPrice><UnitPriceTaxInclusive>${amount}</UnitPriceTaxInclusive><ClassifiedTaxCategory><Percent>${vatRate}</Percent><VATCalculationMethod>0</VATCalculationMethod></ClassifiedTaxCategory><Item><Description>${escapeXml(vendorName + ' - ' + (inv.type || 'Faktura'))}</Description></Item></InvoiceLine></InvoiceLines>
</Invoice>`;
}

export function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}