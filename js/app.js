import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import { CONFIG } from './config.js'; // Imports the variables from config.js!

class StorageService {
    static saveSession(amount, name) {
        localStorage.setItem('recentDonationAmount', amount.toFixed(2));
        localStorage.setItem('recentDonorName', name);
    }
    static getSession() {
        return {
            amount: localStorage.getItem('recentDonationAmount') || "30.00",
            name: localStorage.getItem('recentDonorName') || "Supporter"
        };
    }
    static clearSession() {
        localStorage.removeItem('recentDonationAmount');
        localStorage.removeItem('recentDonorName');
    }
}

class DatabaseService {
    constructor(config) {
        const app = initializeApp(config);
        getAnalytics(app);
        this.db = getFirestore(app);
    }
    listenToLiveTotals(onUpdateCallback) {
        const totalRef = doc(this.db, "fundraiser", "test_totals");
        onSnapshot(totalRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const liveTotal = docSnapshot.data().amountRaised || 0;
                onUpdateCallback(liveTotal);
            }
        });
    }
}

class CheckoutService {
    static async process(payload) {
        const response = await fetch('/.netlify/functions/create-checkout', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error(data.error || "Unknown error occurred");
        }
    }
}

class ModalManager {
    constructor() {
        this.modals = {
            privacy: document.getElementById('privacyModal'),
            terms: document.getElementById('termsModal'),
            about: document.getElementById('aboutModal')
        };
        this.bindEvents();
    }
    bindEvents() {
        document.getElementById('openPrivacy').addEventListener('click', (e) => this.open(e, this.modals.privacy));
        document.getElementById('openTerms').addEventListener('click', (e) => this.open(e, this.modals.terms));

        document.getElementById('openAbout').addEventListener('click', (e) => this.open(e, this.modals.about));

        document.querySelectorAll('.modal-close-icon, .modal-close-btn').forEach(btn => {
            btn.addEventListener('click', () => this.closeAll());
        });

        window.addEventListener('click', (e) => {
            if (e.target === this.modals.privacy || e.target === this.modals.terms) {
                this.closeAll();
            }
        });
    }
    open(e, modalElement) {
        e.preventDefault();
        modalElement.classList.add('active');
    }
    closeAll() {
        Object.values(this.modals).forEach(modal => modal.classList.remove('active'));
    }
}

class UIManager {
    constructor() {
        this.elements = {
            progressFill: document.getElementById('progressBarFill'),
            progressText: document.getElementById('currentAmountText'),
            shippingSection: document.getElementById('shippingSection'),
            addressFields: document.getElementById('addressFields'),
            shippingInputs: document.getElementById('shippingSection').querySelectorAll('input[type="text"]'),
            submitBtn: document.getElementById('submitBtn'),
            formCard: document.getElementById('donationForm'),
            successCard: document.getElementById('successView'),
            receiptName: document.getElementById('receiptName'),
            coinConfirmation: document.getElementById('coinConfirmation'),
            receiptAmount: document.getElementById('receiptAmount')
        };
    }
    updateProgressBar(currentTotal, goal) {
        let percent = (currentTotal / goal) * 100;
        this.elements.progressFill.style.width = `${Math.min(percent, 100)}%`;
        this.elements.progressText.textContent = '$' + currentTotal.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    updateFormState(amount, wantsCoin, isQualifying) {
        let checkoutTotal = amount;
        if (isQualifying) {
            this.elements.shippingSection.classList.remove('hidden');
            if (wantsCoin) {
                this.elements.addressFields.style.display = 'block';
                this.elements.shippingInputs.forEach(i => i.setAttribute('required', 'true'));
                checkoutTotal += CONFIG.fundraiser.shippingFee;
                this.elements.submitBtn.textContent = `Donate & Receive Coin ($${checkoutTotal.toFixed(2)})`;
            } else {
                this.elements.addressFields.style.display = 'none';
                this.elements.shippingInputs.forEach(i => i.removeAttribute('required'));
                this.elements.submitBtn.textContent = `Donate $${checkoutTotal.toFixed(2)}`;
            }
        } else {
            this.elements.shippingSection.classList.add('hidden');
            this.elements.shippingInputs.forEach(i => i.removeAttribute('required'));
            this.elements.submitBtn.textContent = `Donate $${checkoutTotal.toFixed(2)}`;
        }
    }
    setLoadingState(isLoading) {
        this.elements.submitBtn.disabled = isLoading;
        this.elements.submitBtn.textContent = isLoading ? "Processing Securely..." : "Donate Now";
    }
    showSuccessScreen(name, amount) {
        this.elements.formCard.style.display = 'none';
        this.elements.successCard.style.display = 'block';
        this.elements.receiptName.textContent = name;
        this.elements.receiptAmount.textContent = "$" + amount;
        this.elements.coinConfirmation.textContent = "Your generous gift has been processed. If your donation qualified, your Commemorative Coin will be shipped soon.";
    }
    resetForm() {
        this.elements.formCard.reset();
        this.elements.successCard.style.display = 'none';
        this.elements.formCard.style.display = 'block';
        this.elements.formCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

class FundraiserApp {
    constructor() {
        this.currentAmount = CONFIG.fundraiser.defaultDonation;
        this.db = new DatabaseService(CONFIG.firebase);
        this.ui = new UIManager();
        this.modals = new ModalManager();

        this.bindEvents();
        this.checkReturnState();

        this.db.listenToLiveTotals((total) => {
            this.ui.updateProgressBar(total, CONFIG.fundraiser.goalAmount);
        });
    }
    bindEvents() {
        document.querySelectorAll('input[name="amount"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value !== 'custom') {
                    this.currentAmount = parseFloat(e.target.value);
                    document.getElementById('customInput').value = '';
                    this.refreshUI();
                }
            });
        });
        document.getElementById('customInput').addEventListener('input', (e) => {
            document.getElementById('customRadio').checked = true;
            this.currentAmount = parseFloat(e.target.value) || 0;
            this.refreshUI();
        });
        document.getElementById('wantCoinCheckbox').addEventListener('change', () => this.refreshUI());
        document.getElementById('donationForm').addEventListener('submit', (e) => this.handleCheckout(e));
        document.getElementById('donateAgainBtn').addEventListener('click', () => {
            this.ui.resetForm();
            this.currentAmount = CONFIG.fundraiser.defaultDonation;
            this.refreshUI();
        });
        this.refreshUI();
    }
    refreshUI() {
        const wantsCoin = document.getElementById('wantCoinCheckbox').checked;
        const isQualifying = this.currentAmount >= CONFIG.fundraiser.coinQualifyingAmount;
        this.ui.updateFormState(this.currentAmount, wantsCoin, isQualifying);
    }
    checkReturnState() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('success') === 'true') {
            const session = StorageService.getSession();
            this.ui.showSuccessScreen(session.name, session.amount);
            window.history.replaceState({}, document.title, window.location.pathname);
            StorageService.clearSession();
        }
    }
    async handleCheckout(e) {
        e.preventDefault();
        if (document.getElementById('website_url').value !== "") return;

        this.ui.setLoadingState(true);
        const donorName = document.getElementById('fullName').value.trim();
        const wantsCoin = document.getElementById('wantCoinCheckbox').checked;
        const isQualifying = this.currentAmount >= CONFIG.fundraiser.coinQualifyingAmount;
        let finalShippingFee = (isQualifying && wantsCoin) ? CONFIG.fundraiser.shippingFee : 0;

        const payload = {
            amount: this.currentAmount,
            shippingFee: finalShippingFee,
            donorName: donorName,
            email: document.getElementById('emailAddress').value.trim(),
            chapter: document.getElementById('kappaChapter').value.trim() || "None",
            address: isQualifying ? document.getElementById('streetAddress').value.trim() : "N/A",
            city: isQualifying ? document.getElementById('city').value.trim() : "N/A",
            zip: isQualifying ? document.getElementById('zipCode').value.trim() : "N/A"
        };

        StorageService.saveSession(this.currentAmount + finalShippingFee, donorName);

        try {
            await CheckoutService.process(payload);
        } catch (err) {
            alert("Checkout Error: " + err.message);
            this.ui.setLoadingState(false);
            this.refreshUI();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new FundraiserApp();
});
