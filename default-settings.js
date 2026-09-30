// Default shop settings: statuses, visible table columns, the customer
// print template and the phone-model suggestion list. Used to seed a new
// database (db.js) and to reset the demo (demo.js).
const DEFAULT_SETTINGS = {
  shopName: 'CrazyPhone',
  shopTagline: 'аксесоари и сервиз',
  statuses: ['за сервиз', 'в сервиз', 'чака клиент', 'издаден', 'отказан', 'забравен'],
  columns: ['customer', 'callBtn', 'model', 'issue', 'password', 'comment', 'repairPerformed', 'loanerPhone', 'pravim', 'status', 'kaparo', 'servicePrice', 'customerPrice', 'dateIn', 'dateReturned'],
  printCustomer: {
    header: 'СЕРВИЗНА КАРТА',
    footer: 'МАГАЗИНЪТ И СЕРВИЗЪТ НЕ НОСЯТ ОТГОВОРНОСТ ЗА:\nИЗГУБЕНА ПРИ РЕМОНТА ИНФОРМАЦИЯ ОТ МОБИЛНИТЕ АПАРАТИ\nАПАРАТИ НЕПОТЪРСЕНИ ДО 1 МЕСЕЦ ОТ ДАТАТА НА ПРИЕМАНЕ'
  },
  devices: [
    'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15', 'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini', 'iPhone 12', 'iPhone 11',
    'iPhone SE (2022)', 'iPhone XR',
    'Samsung Galaxy S25 Ultra', 'Samsung Galaxy S25', 'Samsung Galaxy S24 Ultra', 'Samsung Galaxy S24',
    'Samsung Galaxy S23 Ultra', 'Samsung Galaxy S23', 'Samsung Galaxy A55', 'Samsung Galaxy A54',
    'Samsung Galaxy A35', 'Samsung Galaxy Z Flip 6', 'Samsung Galaxy Z Fold 6', 'Samsung Galaxy Note 20',
    'Xiaomi Redmi Note 13', 'Xiaomi Redmi Note 12', 'Xiaomi 14', 'Xiaomi 13T', 'Xiaomi Poco X6',
    'Huawei P60', 'Huawei Mate 50', 'Huawei Nova 11',
    'Google Pixel 9', 'Google Pixel 8', 'Google Pixel 7',
    'OnePlus 12', 'OnePlus Nord 3',
    'Oppo Reno 11', 'Oppo A98',
    'Motorola Edge 40'
  ]
};

module.exports = DEFAULT_SETTINGS;
